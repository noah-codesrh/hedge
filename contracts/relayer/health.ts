/**
 * Liveness surface for the keeper.
 *
 * The failure that actually costs money is the silent one: the process is up,
 * the logs look calm, but prices stopped flowing an hour ago and nothing got
 * liquidated. So "is the process running" is not the health question. The
 * question is "did a tick succeed recently", and that is what `/health`
 * answers — 200 while ticks are landing, 503 once they stop.
 *
 * Point an uptime monitor at it. If the container dies the endpoint stops
 * answering and the monitor alerts; if the container lives but the keeper
 * stalls, the endpoint answers 503 and the monitor alerts. Both paths end in
 * somebody being woken up, which is the whole point.
 */
import { createServer, type Server } from "node:http";

export type KeeperStatus = {
  startedAt: number;
  /** Last time a tick finished without throwing. */
  lastHealthyTickAt: number | null;
  lastTickAt: number | null;
  consecutiveFailures: number;
  ticks: number;
  pricesPushed: number;
  liquidations: number;
  settlements: number;
  /** Native balance in wei, for gas exhaustion. */
  balanceWei: string | null;
  lowBalance: boolean;
  openingPaused: boolean;
  lastError: string | null;
  watching: number;
};

export const status: KeeperStatus = {
  startedAt: Date.now(),
  lastHealthyTickAt: null,
  lastTickAt: null,
  consecutiveFailures: 0,
  ticks: 0,
  pricesPushed: 0,
  liquidations: 0,
  settlements: 0,
  balanceWei: null,
  lowBalance: false,
  openingPaused: false,
  lastError: null,
  watching: 0,
};

/**
 * A keeper is unhealthy once it has gone longer than this without a clean
 * tick. Default sits just under the oracle's 5 minute staleness window, so the
 * alert fires while trading is still open rather than after it has already
 * halted itself.
 */
const STALE_AFTER_MS = Number(process.env.HEALTH_STALE_AFTER_MS ?? 240_000);

/** How long to keep trying a port an outgoing keeper has not released yet. */
const BIND_RETRY_MS = Number(process.env.HEALTH_BIND_RETRY_MS ?? 30_000);

export function staleness(now = Date.now()): number {
  return now - (status.lastHealthyTickAt ?? status.startedAt);
}

/**
 * Whether ticks are still landing — and nothing else.
 *
 * Low gas is deliberately not a liveness failure. An orchestrator reacts to
 * 503 by killing and restarting the container, which cannot mint ETH, so a
 * keeper that was ticking perfectly would be restart-looped for a problem a
 * restart does not fix. Gas exhaustion is not missed either: once the balance
 * genuinely runs out the transactions start reverting, ticks stop landing and
 * staleness trips this on its own.
 */
export function isHealthy(now = Date.now()): boolean {
  return staleness(now) <= STALE_AFTER_MS;
}

/** Working now, but needs a human before it stops working. */
export function isDegraded(): boolean {
  return status.lowBalance;
}

export function snapshot() {
  const now = Date.now();
  return {
    healthy: isHealthy(now),
    degraded: isDegraded(),
    uptimeSeconds: Math.floor((now - status.startedAt) / 1_000),
    stalenessSeconds: Math.floor(staleness(now) / 1_000),
    staleAfterSeconds: Math.floor(STALE_AFTER_MS / 1_000),
    ...status,
  };
}

/**
 * Prometheus exposition, for anyone already running one. Deliberately a handful
 * of counters rather than a full client library — an extra dependency on the
 * box that has to stay up is a liability.
 */
function prometheus(): string {
  const s = snapshot();
  return [
    `# HELP hedge_keeper_healthy 1 when the keeper has ticked recently.`,
    `# TYPE hedge_keeper_healthy gauge`,
    `hedge_keeper_healthy ${s.healthy ? 1 : 0}`,
    `# HELP hedge_keeper_staleness_seconds Seconds since the last clean tick.`,
    `# TYPE hedge_keeper_staleness_seconds gauge`,
    `hedge_keeper_staleness_seconds ${s.stalenessSeconds}`,
    `# HELP hedge_keeper_consecutive_failures Ticks that have failed back to back.`,
    `# TYPE hedge_keeper_consecutive_failures gauge`,
    `hedge_keeper_consecutive_failures ${s.consecutiveFailures}`,
    `# HELP hedge_keeper_ticks_total Ticks attempted since start.`,
    `# TYPE hedge_keeper_ticks_total counter`,
    `hedge_keeper_ticks_total ${s.ticks}`,
    `# HELP hedge_keeper_prices_pushed_total Oracle updates submitted.`,
    `# TYPE hedge_keeper_prices_pushed_total counter`,
    `hedge_keeper_prices_pushed_total ${s.pricesPushed}`,
    `# HELP hedge_keeper_liquidations_total Positions liquidated.`,
    `# TYPE hedge_keeper_liquidations_total counter`,
    `hedge_keeper_liquidations_total ${s.liquidations}`,
    `# HELP hedge_keeper_settlements_total Positions settled after resolution.`,
    `# TYPE hedge_keeper_settlements_total counter`,
    `hedge_keeper_settlements_total ${s.settlements}`,
    `# HELP hedge_keeper_low_balance 1 when gas is below the warning floor.`,
    `# TYPE hedge_keeper_low_balance gauge`,
    `hedge_keeper_low_balance ${s.lowBalance ? 1 : 0}`,
    "",
  ].join("\n");
}

/**
 * Railway sets PORT and the public domain is pinned to a port in Networking.
 * HEALTH_PORT=${{PORT}} is often stored as that literal string, so Number()
 * becomes NaN and nothing listens on 8080 — the proxy then 502s /health
 * while the keeper is still ticking.
 */
export function listenPort(): number {
  for (const raw of [process.env.HEALTH_PORT, process.env.PORT, "8080"]) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return 8080;
}

export function startHealthServer(port = listenPort()): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      res.end(prometheus());
      return;
    }

    if (path === "/health" || path === "/") {
      const body = snapshot();
      res.writeHead(body.healthy ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify(body, null, 2));
      return;
    }

    res.writeHead(404).end();
  });

  /**
   * Keep retrying a taken port for a short while before giving up.
   *
   * Shutdown is not instant: the SIGTERM handler pulls the guardian pause,
   * which is an on-chain transaction, and the old process holds this port
   * until that receipt lands. Any supervisor that restarts faster than that —
   * docker `restart: always`, a k8s liveness kill, systemd — would otherwise
   * hit EADDRINUSE and crash-loop a keeper that is merely being replaced.
   *
   * Only the "someone else has it" case retries. Anything else is a real
   * failure and should still take the process down loudly.
   */
  const deadline = Date.now() + BIND_RETRY_MS;
  // Logged via `once` rather than a listen callback: a failed listen leaves its
  // callback registered, so retrying would print one line per attempt when the
  // port finally frees up.
  server.once("listening", () => console.log(`[health] listening on :${port}`));
  const bind = () => server.listen(port);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EADDRINUSE") throw err;
    if (Date.now() >= deadline) {
      throw new Error(
        `[health] port ${port} still in use after ${BIND_RETRY_MS}ms. ` +
          "Another keeper is probably still shutting down.",
      );
    }
    setTimeout(bind, 500).unref();
  });

  bind();
  // Never let the health server hold the process open on its own.
  server.unref();
  return server;
}
