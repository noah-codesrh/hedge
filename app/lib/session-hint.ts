import { useEffect, useLayoutEffect, useState } from "react";
import { forgetAccessToken } from "./privy-session";

const KEY = "hedge-session";

/** Keys Privy writes for an email / social session. */
const PRIVY_KEYS = ["privy:token", "privy:refresh_token", "privy:id_token"];

/** True when Privy still has something to restore from this browser. */
export function hasPrivyStorage() {
  if (typeof window === "undefined") return false;
  try {
    return PRIVY_KEYS.some((key) => Boolean(window.localStorage.getItem(key)));
  } catch {
    return false;
  }
}

/**
 * First paint only. After Privy is ready, `authenticated` is the login.
 * Dead `privy:*` keys used to keep Log out on screen after a refresh.
 */
export function sessionStillHeld() {
  return readSessionHint();
}

/**
 * Signed-in chrome while Privy is still mounting.
 * Once ready, a false `authenticated` is a logout. Leftover tokens are not.
 */
export function useHeldSession(authenticated: boolean, ready: boolean) {
  const [held, setHeld] = useState(false);

  useLayoutEffect(() => {
    setHeld(sessionStillHeld());
  }, []);

  useEffect(() => {
    if (authenticated) {
      writeSessionHint(true);
      setHeld(true);
      return;
    }
    if (!ready) return;
    forgetAccessToken();
    writeSessionHint(false);
    setHeld(false);
  }, [authenticated, ready]);

  return held;
}

/**
 * Cheap "this browser was signed in" flag.
 *
 * Privy keeps the real tokens in localStorage and restores them after its
 * provider mounts. That mount is delayed (SSR, then a lazy chunk), and the
 * header treats the gap as logged out — so leaving the site and coming back
 * looks like an instant logout even though the session is still there.
 *
 * This hint is written when Privy reports signed in. It is cleared only on
 * Logout. A brief `authenticated: false` while Privy remounts must not wipe
 * it, or a refresh looks like a logout.
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
