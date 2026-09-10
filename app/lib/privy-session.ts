/**
 * Privy refresh tokens are one-use. A getAccessToken() during restore
 * consumes the token and the next paint is logged out. Background reads
 * wait this long after mount.
 */
export const PRIVY_RESTORE_MS = 8_000;

let cached: string | null = null;
let inflight: Promise<string | null> | null = null;

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

/**
 * One in-flight Privy token read at a time. Five rapid getAccessToken()
 * calls on Close used to rotate the refresh token twice and log them out.
 */
export async function requireAccessToken(
  getAccessToken: () => Promise<string | null>,
) {
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
export async function refreshAccessToken(
  getAccessToken: () => Promise<string | null>,
) {
  return requireAccessToken(getAccessToken);
}

export function sessionLostMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return isSessionLoss(message) ? message : null;
}
