import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { beginPrivyRestore } from "./lib/privy-session";
import { requestPersistentStorage } from "./lib/pwa";

/**
 * No StrictMode. React Router's default client entry wraps the tree in it,
 * which mounts Privy, tears it down, and mounts it again. Privy refresh
 * tokens are one-use; that remount consumes the session and a reload looks
 * like a logout.
 */
startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});

beginPrivyRestore();

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  if (!import.meta.env.DEV) {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  requestPersistentStorage();
}
