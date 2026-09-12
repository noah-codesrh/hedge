const DISMISS_KEY = "hedge-pwa-dismissed";

export function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia("(display-mode: standalone)").matches;
  const ios = "standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone);
  return media || ios;
}

export function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function pwaDismissed() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return true;
  }
}

export function dismissPwaHint() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private mode */
  }
}

/** Ask the browser to keep Privy tokens after the tab is gone. */
export function requestPersistentStorage() {
  if (typeof navigator === "undefined") return;
  const persist = navigator.storage?.persist;
  if (!persist) return;
  void persist().catch(() => {});
}
