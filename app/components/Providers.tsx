import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { ENV } from "../lib/env";
import { AuthModalProvider, useAuthModal } from "./auth-modal";
import { LoginModal } from "./LoginModal";
import { BookProvider } from "./Book";

const PrivyRoot = lazy(() => import("./PrivyRoot"));

export { useAuthModal } from "./auth-modal";

/**
 * `loading` is the window where Privy is wanted but its chunk has not arrived.
 * It has to be distinguishable from `ready`: Privy's hooks throw outside a
 * `PrivyProvider`, so anything rendered during that window must not call them.
 */
type PrivyStatus = "unconfigured" | "loading" | "ready";

const PrivyStatusContext = createContext<PrivyStatus>("unconfigured");

export function usePrivyStatus() {
  return useContext(PrivyStatusContext);
}

/** True only where a `PrivyProvider` is really above you and its hooks are safe. */
export function usePrivyMounted() {
  return useContext(PrivyStatusContext) === "ready";
}

/**
 * Rendered inside whichever branch is live, because at `ready` the modal calls
 * Privy hooks and so has to be under the real `PrivyProvider`.
 */
function AuthModal() {
  const { open, closeModal } = useAuthModal();
  return <LoginModal open={open} onClose={closeModal} />;
}

/** Reports upward once a real `PrivyProvider` is above it. */
function MarkPrivyReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [wantPrivy, setWantPrivy] = useState(false);
  const [privyReady, setPrivyReady] = useState(false);

  useEffect(() => {
    if (ENV.privyAppId) setWantPrivy(true);
  }, []);

  const onPrivyReady = useCallback(() => setPrivyReady(true), []);

  // Carried as state rather than by tree position, so the handoff from loading
  // to ready is a new context value instead of a new subtree.
  const status: PrivyStatus = privyReady
    ? "ready"
    : ENV.privyAppId
      ? "loading"
      : "unconfigured";

  // No BookProvider and no Privy above it, so nothing here may call a Privy
  // hook. `LoginModal` keys off the status to stay on the safe side.
  const guest = (
    <>
      {children}
      <AuthModal />
    </>
  );

  return (
    <PrivyStatusContext.Provider value={status}>
      {/*
        AuthModalProvider has to stay mounted across the Privy handoff. Building
        a fresh one on the far side resets `open`, so a Get Started click made
        while the chunk was still in flight opened a modal that was thrown away
        the moment Privy arrived — which read as the button doing nothing.
      */}
      <AuthModalProvider>
        {wantPrivy ? (
          <Suspense fallback={guest}>
            <PrivyRoot>
              <MarkPrivyReady onReady={onPrivyReady} />
              <BookProvider>
                {children}
                <AuthModal />
              </BookProvider>
            </PrivyRoot>
          </Suspense>
        ) : (
          guest
        )}
      </AuthModalProvider>
    </PrivyStatusContext.Provider>
  );
}
