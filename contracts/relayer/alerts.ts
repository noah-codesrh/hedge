/**
 * Outbound alerting for the keeper.
 *
 * Posts to a Slack/Discord-compatible webhook, and to Telegram if a bot token
 * is configured. Both are optional; with neither set this degrades to logging,
 * which is fine locally and not fine in production.
 *
 * Two rules keep the channel worth reading:
 *
 *  - Repeats of the same alert are suppressed for a cooldown, so a keeper stuck
 *    in a failing loop sends one message every few minutes instead of one every
 *    tick. An alert channel people mute is the same as no alert channel.
 *  - Recovery is announced. Knowing something broke is only half of it.
 */
const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL ?? "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS ?? 900_000);

export type Severity = "info" | "warn" | "critical";

const ICON: Record<Severity, string> = { info: "🟢", warn: "🟡", critical: "🔴" };

/** Last time each alert key was sent, so repeats can be throttled. */
const lastSent = new Map<string, number>();
/** Keys currently in a firing state, so recovery can be announced once. */
const firing = new Set<string>();

const label = process.env.KEEPER_LABEL ?? "hedge-keeper";

async function deliver(text: string): Promise<void> {
  const sends: Promise<unknown>[] = [];

  if (WEBHOOK_URL) {
    sends.push(
      fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `text` satisfies Slack and Discord; `content` is Discord's field.
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(8_000),
      }),
    );
  }

  if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    sends.push(
      fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
        signal: AbortSignal.timeout(8_000),
      }),
    );
  }

  if (sends.length === 0) return;

  // An alert that throws must never take down the keeper it is reporting on.
  const results = await Promise.allSettled(sends);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[alert] delivery failed", result.reason);
    }
  }
}

/**
 * Raise an alert, at most once per cooldown per `key`.
 * @param key stable identifier for the condition, e.g. "relay-failing".
 */
export async function alert(key: string, severity: Severity, message: string): Promise<void> {
  const line = `${ICON[severity]} [${label}] ${message}`;
  console[severity === "info" ? "log" : "warn"](line);

  firing.add(key);

  const previous = lastSent.get(key) ?? 0;
  if (Date.now() - previous < COOLDOWN_MS) return;
  lastSent.set(key, Date.now());

  await deliver(line);
}

/** Announce that a previously firing condition has cleared. No-op otherwise. */
export async function resolve(key: string, message: string): Promise<void> {
  if (!firing.delete(key)) return;
  lastSent.delete(key);
  const line = `${ICON.info} [${label}] ${message}`;
  console.log(line);
  await deliver(line);
}
