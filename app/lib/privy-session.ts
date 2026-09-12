/**
 * Privy refresh tokens are one-use. A getAccessToken() while the provider is
 * still hydrating from localStorage consumes the token. The next paint is
 * then a logout. One global clock, one in-flight read.
 */
export const PRIVY_RESTORE_MS = 8_000;

let cached: string | null = null;
let inflight: Promise<string | null> | null = null;
let restoreGate: Promise<void> | null = null;
let restoreDone = false;

export function beginPrivyRestore() {
  if (restoreGate) return restoreGate;
  restoreGate = new Promise((resolve) => {
    const finish = () => {
      restoreDone = true;
      resolve();
    };
    if (typeof window === "undefined") {
      finish();
      return;
    }
    window.setTimeout(finish, PRIVY_RESTORE_MS);
  });
  return restoreGate;
}

export function resetPrivyRestore() {
  cached = null;
  inflight = null;
  restoreGate = null;
  restoreDone = false;
}

export function privyRestoreDone() {
  return restoreDone;
}

function readJwtExp(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

function tokenStillGood(token: string) {
  const exp = readJwtExp(token);
  if (exp == null) return false;
  return exp * 1000 > Date.now() + 120_000;
}

/** Drop the in-memory token. Call this on Logout only. */
export function forgetAccessToken() {
  cached = null;
  inflight = null;
}

function isSessionLoss(message: string) {
  return /sign in|session expired/i.test(message);
}

export type AccessTokenFn = () => Promise<string | null>;

/**
 * One in-flight Privy token read at a time, after restore.
 * Five rapid getAccessToken() calls used to rotate the refresh token twice
 * and log the trader out.
 */
export async function requireAccessToken(getAccessToken: AccessTokenFn) {
  if (!restoreDone) await beginPrivyRestore();
  if (cached && tokenStillGood(cached)) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const token = await getAccessToken().catch(() => null);
    if (token) cached = token;
    return token;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Keep the session warm. Failures stay local. Never treat them as logout. */
export async function refreshAccessToken(getAccessToken: AccessTokenFn) {
  return requireAccessToken(getAccessToken);
}

export function sessionLostMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return isSessionLoss(message) ? message : null;
}

if (typeof window !== "undefined") {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) resetPrivyRestore();
  });
}
