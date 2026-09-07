const KEY = "hedge-session";

/**
 * Cheap "this browser was signed in" flag.
 *
 * Privy keeps the real tokens in localStorage and restores them after its
 * provider mounts. That mount is delayed (SSR, then a lazy chunk), and the
 * header treats the gap as logged out — so leaving the site and coming back
 * looks like an instant logout even though the session is still there.
 *
 * This hint is written on a successful Privy restore and cleared on logout.
 * The chrome reads it synchronously after hydrate so a returning trader
 * stays signed in on screen while Privy catches up.
 */
export function readSessionHint() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSessionHint(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
