import type { PrivyAuthorizationPayload, SignPrivyAuthorization } from "./sponsored-send";

const TOTAL_MS = 20 * 60 * 1000;
const SETTLE_MS = 8 * 60 * 1000;
const TICK_MS = 3000;

type Waiting = { status: "waiting"; usdc?: string };
type Ready = {
  status: "ready";
  amount: string;
  requestExpiry: number;
  payload: PrivyAuthorizationPayload;
};
type Sent = { status: "sent"; id?: string; amount?: string };

function isAuthReject(err: unknown) {
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");
  return /cancel|closed|exited|dismiss|abort|user.?reject|denied/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function usdgBalance(address: string) {
  try {
    const res = await fetch(`/api/assets?address=${encodeURIComponent(address)}`);
    const data = (await res.json().catch(() => null)) as {
      assets?: { symbol: string; balance: number }[];
    } | null;
    return data?.assets?.find((row) => row.symbol === "USDG")?.balance ?? 0;
  } catch {
    return null;
  }
}

async function post(
  accessToken: string,
  body: unknown,
): Promise<(Waiting | Ready | Sent) & { error?: string }> {
  const res = await fetch("/api/rh/cash-in", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | ((Waiting | Ready | Sent) & { error?: string })
    | null;
  if (res.status === 401) throw new Error("Session expired. Sign in again.");
  if (res.status === 403) {
    throw new Error(data?.error ?? "Could not convert this wallet to USDG.");
  }
  if (!data) return { status: "waiting" };
  if (!res.ok) return { status: "waiting" };
  return data;
}

/**
 * Wait for the onramp USDC to land on Base, then keep bridging to USDG until
 * cash shows up. Transient RPC, quote, and send failures retry for 20 minutes.
 */
export async function convertOnrampToCash(input: {
  getAccessToken: () => Promise<string | null>;
  from: string;
  signAuthorization: SignPrivyAuthorization;
  usdgBefore: number;
  onPhase?: (phase: "wait" | "convert") => void;
}) {
  const deadline = Date.now() + TOTAL_MS;
  const expect = 0.5;
  let variant = 0;

  const token = async () => {
    const access = await input.getAccessToken();
    if (!access) throw new Error("Session expired. Sign in again.");
    return access;
  };

  const cashReady = async () => {
    const usdg = await usdgBalance(input.from);
    return usdg != null && usdg >= input.usdgBefore + expect;
  };

  while (Date.now() < deadline) {
    if (await cashReady()) return;
    input.onPhase?.("wait");
    let access: string;
    try {
      access = await token();
    } catch (err) {
      if (isAuthReject(err)) throw err;
      await sleep(TICK_MS);
      continue;
    }

    const next = await post(access, { from: input.from, variant });
    if (next.status !== "ready") {
      await sleep(TICK_MS);
      continue;
    }

    input.onPhase?.("convert");
    try {
      const signature = await input.signAuthorization(next.payload);
      await post(access, {
        from: input.from,
        amount: next.amount,
        signature,
        requestExpiry: next.requestExpiry,
        variant,
      });
    } catch (err) {
      if (isAuthReject(err)) throw err;
      variant += 1;
      await sleep(TICK_MS);
      continue;
    }

    const settleUntil = Math.min(deadline, Date.now() + SETTLE_MS);
    while (Date.now() < settleUntil) {
      if (await cashReady()) return;
      await sleep(TICK_MS);
    }
    variant += 1;
  }

  if (await cashReady()) return;
}
