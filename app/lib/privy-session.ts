import { sleep } from "./evm";

function isSessionLoss(message: string) {
  return /sign in|session expired/i.test(message);
}

/**
 * Privy keeps you "authenticated" in memory after you leave, then
 * `getAccessToken` either refreshes or force-logs you out. A buy that
 * runs before that refresh finishes shows "Sign in again" on a screen
 * that still looks signed in.
 */
export async function requireAccessToken(
  getAccessToken: () => Promise<string | null>,
) {
  let token: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    token = await getAccessToken().catch(() => null);
    if (token) return token;
    await sleep(300 * (attempt + 1));
  }
  return null;
}

export function sessionLostMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return isSessionLoss(message) ? message : null;
}
