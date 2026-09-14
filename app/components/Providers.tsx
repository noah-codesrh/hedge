import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ENV } from "../lib/env";
import type { Locale } from "../lib/i18n";
import { AuthModalProvider, useAuthModal } from "./auth-modal";
import { I18nProvider } from "./I18n";
import { LanguagePickerHost } from "./LanguagePicker";
import { LoginModal, PrivyLoginMethods } from "./LoginModal";
import { BookProvider } from "./Book";

const PrivyRoot = lazy(() => import("./PrivyRoot"));

if (typeof window !== "undefined") {
  void import("./PrivyRoot");
}

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

/** Reports upward once a real `PrivyProvider` is above it. */
function MarkPrivyReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

const PRIVY_OVERLAYS =
  "#privy-dialog, #privy-dialog-backdrop, #privy-modal-content";

/**
 * Privy's dialog is z-index 999999. Some Chrome profiles mount it on boot
 * (restore spinner, empty shell, a lone close button). That used to flip
 * pointer-events back on and swallow Log in / language. Only unlock it when
 * we opened Connect wallet.
 */
function NeutralizePrivyOverlay() {
  const { walletLayer, closeWalletLayer } = useAuthModal();
  const allowRef = useRef(walletLayer);
  allowRef.current = walletLayer;

  useEffect(() => {
    const apply = () => {
      const allow = allowRef.current;
      document.documentElement.classList.toggle("privy-interact", allow);
      document.querySelectorAll(PRIVY_OVERLAYS).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (allow) node.removeAttribute("inert");
        else node.setAttribute("inert", "");
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("privy-interact");
    };
  }, [walletLayer]);

  useEffect(() => {
    if (!walletLayer) return;
    const started = Date.now();
    const tick = () => {
      if (Date.now() - started < 1_500) return;
      if (!document.getElementById("privy-dialog")) closeWalletLayer();
    };
    const timer = window.setInterval(tick, 400);
    return () => window.clearInterval(timer);
  }, [walletLayer, closeWalletLayer]);

  return null;
}

/** Survives a Providers remount so Privy is not torn down mid-session. */
let privyClientOnce = false;

export function Providers({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale?: Locale;
}) {
  const [wantPrivy, setWantPrivy] = useState(privyClientOnce);
  const [privyReady, setPrivyReady] = useState(false);

  useLayoutEffect(() => {
    if (!ENV.privyAppId) return;
    privyClientOnce = true;
    setWantPrivy(true);
  }, []);

  const onPrivyReady = useCallback(() => setPrivyReady(true), []);

  const status: PrivyStatus = privyReady
    ? "ready"
    : ENV.privyAppId
      ? "loading"
      : "unconfigured";

  return (
    <PrivyStatusContext.Provider value={status}>
      <I18nProvider initialLocale={locale}>
        <LanguagePickerHost />
        <AuthModalProvider>
          <NeutralizePrivyOverlay />
        {/*
          The sheet is a sibling of the Privy handoff, not a child of it.
          A Get Started click during chunk load used to open a modal that
          unmounted the moment Privy arrived.
        */}
          <LoginModal />
          {wantPrivy ? (
            <Suspense fallback={null}>
              <PrivyRoot>
                <MarkPrivyReady onReady={onPrivyReady} />
                <PrivyLoginMethods />
                <BookProvider>{children}</BookProvider>
              </PrivyRoot>
            </Suspense>
          ) : (
            children
          )}
        </AuthModalProvider>
      </I18nProvider>
    </PrivyStatusContext.Provider>
  );
}
