import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import {
  usePrivy,
  useLogin,
  useLoginWithEmail,
  useLoginWithOAuth,
} from "@privy-io/react-auth";
import { useAuthModal } from "./auth-modal";
import { HoneycombMarquee } from "./HoneycombMarquee";
import {
  DiscordIcon,
  GoogleIcon,
  WalletIcon,
  XIcon,
} from "./icons";

/**
 * Login chrome. No Privy hooks. Lives outside the Privy handoff so a Get
 * Started click is never thrown away when the provider chunk arrives.
 *
 * Methods render into `#hedge-login-methods` from inside `PrivyRoot`.
 */
export function LoginModal() {
  const { open, closeModal, walletLayer } = useAuthModal();

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`hedge-login-root fixed inset-0 flex items-end justify-center p-0 animate-fade-in sm:items-center sm:p-4 ${
        walletLayer ? "z-[80] pointer-events-none" : "z-[1000001]"
      }`}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={closeModal}
      />
      <div className="relative z-10 max-h-[92dvh] w-full max-w-[440px] overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#161616] shadow-2xl animate-pop-in pointer-events-auto sm:rounded-[28px]">
        <div className="relative h-36 overflow-hidden sm:h-52">
          <HoneycombMarquee columns={3} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-[#161616]" />
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close"
            className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-black transition hover:bg-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6 6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="absolute inset-x-0 bottom-3 z-10 flex flex-col items-center">
            <img
              src="/logo-full-dark.png"
              alt="Hedge"
              className="h-10 w-auto"
            />
          </div>
        </div>

        <div className="px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-7">
          <div className="mb-4 text-center">
            <h2 className="text-lg font-semibold text-white">
              Log in or sign up
            </h2>
          </div>
          <div id="hedge-login-methods" />
          <p className="hedge-login-fallback rounded-xl bg-card-2 p-4 text-center text-sm text-muted">
            Loading login…
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Mounted under `PrivyProvider`. Fills the stable login sheet. */
export function PrivyLoginMethods() {
  const { open, closeModal } = useAuthModal();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setSlot(null);
      return;
    }
    setSlot(document.getElementById("hedge-login-methods"));
  }, [open]);

  if (!slot) return null;
  return createPortal(<PrivyAuthArea onClose={closeModal} />, slot);
}

function PrivyAuthArea({ onClose }: { onClose: () => void }) {
  const { authenticated, ready } = usePrivy();

  useEffect(() => {
    if (authenticated) onClose();
  }, [authenticated, onClose]);

  if (!ready) {
    return (
      <p className="rounded-xl bg-card-2 p-4 text-center text-sm text-muted">
        Loading login…
      </p>
    );
  }

  return <PrivyAuthForm onClose={onClose} />;
}

function PrivyAuthForm({ onClose }: { onClose: () => void }) {
  const { openWalletLayer, closeWalletLayer } = useAuthModal();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { initOAuth } = useLoginWithOAuth();
  const { login } = useLogin();

  const loginWithWallet = () => {
    setError(null);
    openWalletLayer();
    try {
      const result = login({
        loginMethods: ["wallet"],
        walletChainType: "ethereum-only",
      });
      void Promise.resolve(result).catch((err: unknown) => {
        closeWalletLayer();
        setError(
          err instanceof Error
            ? err.message
            : "Could not open the wallet list. Refresh and try again.",
        );
      });
    } catch (err) {
      closeWalletLayer();
      setError(
        err instanceof Error
          ? err.message
          : "Could not open the wallet list. Refresh and try again.",
      );
    }
  };

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const socials = [
    {
      key: "google",
      label: "Google",
      icon: <GoogleIcon />,
      onClick: () => run(() => initOAuth({ provider: "google" })),
    },
    {
      key: "discord",
      label: "Discord",
      icon: <DiscordIcon />,
      onClick: () => run(() => initOAuth({ provider: "discord" })),
    },
    {
      key: "twitter",
      label: "X",
      icon: <XIcon />,
      onClick: () => run(() => initOAuth({ provider: "twitter" })),
    },
  ];

  return (
    <div>
      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email) return;
            run(async () => {
              await sendCode({ email });
              setStep("code");
            });
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3.5 text-white placeholder-[#6b6b6b] outline-none transition focus:border-gold/60"
          />
          <button
            type="submit"
            disabled={busy || !email}
            className="mt-3 w-full rounded-2xl bg-white py-3.5 font-semibold text-black transition hover:bg-white/90 disabled:opacity-60"
          >
            {busy ? "Please wait…" : "Continue with email"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!code) return;
            run(() => loginWithCode({ code }));
          }}
        >
          <p className="mb-2 text-center text-sm text-muted">
            Enter the code sent to <span className="text-white">{email}</span>
          </p>
          <input
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter code"
            className="w-full rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3.5 text-center tracking-[0.4em] text-white placeholder-[#6b6b6b] outline-none focus:border-gold/60"
          />
          <button
            type="submit"
            disabled={busy || !code}
            className="mt-3 w-full rounded-2xl bg-white py-3.5 font-semibold text-black transition hover:bg-white/90 disabled:opacity-60"
          >
            {busy ? "Verifying…" : "Verify & continue"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
            }}
            className="mt-2 w-full text-center text-sm text-muted hover:text-white"
          >
            Use a different email
          </button>
        </form>
      )}

      {step === "email" && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-[#6b6b6b]">
            <div className="h-px flex-1 bg-white/10" />
            or
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <button
            type="button"
            onClick={loginWithWallet}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gold py-3.5 text-[15px] font-semibold text-black transition hover:brightness-105 disabled:opacity-60"
          >
            <WalletIcon size={20} />
            Connect wallet
          </button>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {socials.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={s.onClick}
                disabled={busy}
                aria-label={s.label}
                className="flex h-14 items-center justify-center rounded-2xl border border-white/10 bg-[#1e1e1e] transition hover:border-white/25 hover:bg-[#262626] disabled:opacity-60"
              >
                {s.icon}
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <p className="mt-4 text-center text-sm text-down">{error}</p>
      )}

      <p className="mt-5 text-center text-[11px] leading-relaxed text-[#5f5f5f]">
        By continuing you agree to Hedge&apos;s{" "}
        <Link
          to="/terms"
          onClick={onClose}
          className="text-[#8a8a8a] underline underline-offset-2 transition hover:text-white"
        >
          Terms
        </Link>
        .
      </p>
    </div>
  );
}
