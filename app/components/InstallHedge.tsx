import { useEffect, useState } from "react";
import {
  dismissPwaHint,
  isIosDevice,
  isMobileViewport,
  isStandaloneApp,
  pwaDismissed,
} from "../lib/pwa";

type AndroidPrompt = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: AndroidPrompt | null = null;

function listenForInstall() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as unknown as AndroidPrompt;
    window.dispatchEvent(new Event("hedge:install-ready"));
  });
}

if (typeof window !== "undefined") listenForInstall();

export function InstallHedge({
  force = false,
  onClose,
}: {
  force?: boolean;
  onClose?: () => void;
}) {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    const sync = () => {
      setIos(isIosDevice());
      setCanPrompt(deferred != null);
      if (isStandaloneApp()) {
        setShow(false);
        return;
      }
      if (force) {
        setShow(true);
        return;
      }
      if (!isMobileViewport() || pwaDismissed()) {
        setShow(false);
        return;
      }
      setShow(true);
    };
    sync();
    window.addEventListener("hedge:install-ready", sync);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("hedge:install-ready", sync);
      window.removeEventListener("resize", sync);
    };
  }, [force]);

  if (!show) return null;

  const hide = () => {
    dismissPwaHint();
    setShow(false);
    onClose?.();
  };

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      if (choice.outcome === "accepted") hide();
      return;
    }
  };

  return (
    <div
      className={`fixed inset-x-0 z-50 px-3 ${
        open ? "bottom-[5.75rem] lg:bottom-6" : "bottom-[5.75rem]"
      }`}
    >
      <div className="mx-auto flex max-w-lg items-start gap-3 rounded-2xl bg-[#1b1b1b] px-4 py-3.5 ring-1 ring-white/10">
        <img
          src="/pwa-192.png"
          alt=""
          width={40}
          height={40}
          className="mt-0.5 h-10 w-10 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug">
            Add Hedge to your home screen
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted">
            {ios
              ? "Share, then Add to Home Screen. The login stays when you close Safari."
              : "Open it like an app. The login stays when you leave."}
          </p>
          {!ios && canPrompt ? (
            <button
              type="button"
              onClick={() => void install()}
              className="mt-2.5 rounded-full bg-gold px-3.5 py-1.5 text-[12px] font-semibold text-black"
            >
              Install
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label="Dismiss"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
