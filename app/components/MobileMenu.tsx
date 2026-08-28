import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { DOCS_URL, SOCIALS, SUPPORT_EMAIL } from "./site-links";

/** Matches the panel's transition so the exit finishes before it unmounts. */
const CLOSE_MS = 300;

function ArrowUpRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

const ROW =
  "flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-[15px] font-medium text-[#e6e6e6] transition active:scale-[0.98] hover:bg-white/[0.06] hover:text-white";

export function MobileMenu({
  authenticated,
  onGetStarted,
  onLogout,
}: {
  authenticated: boolean;
  onGetStarted: () => void;
  onLogout: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const shownRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  shownRef.current = shown;

  const close = useCallback(() => {
    setShown(false);
    window.setTimeout(() => {
      // A reopen during the exit has to win, otherwise the drawer unmounts
      // from under a trader who just asked for it back.
      if (!shownRef.current) setMounted(false);
    }, CLOSE_MS);
  }, []);

  const open = useCallback(() => {
    setMounted(true);
    // One frame is enough for the off-screen class to commit. A second rAF
    // was getting dropped on some Chrome profiles, which left the portal
    // mounted at opacity-0 — and that invisible layer ate every click after.
    requestAnimationFrame(() => setShown(true));
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);

    const { style } = document.body;
    const overflowY = style.overflowY;
    const paddingRight = style.paddingRight;
    // Only the y axis: the shorthand would drop the overflow-x clip that keeps
    // wide rows from bleeding sideways. Pad by whatever a visible scrollbar was
    // occupying so the page behind the scrim does not widen as it goes away.
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    style.overflowY = "hidden";
    if (gutter > 0) style.paddingRight = `${gutter}px`;

    return () => {
      window.removeEventListener("keydown", onKey);
      style.overflowY = overflowY;
      style.paddingRight = paddingRight;
    };
  }, [mounted, close]);

  useEffect(() => {
    if (shown) panelRef.current?.focus();
    else if (mounted) buttonRef.current?.focus();
  }, [shown, mounted]);

  // Navigating away leaves the drawer floating over a page it no longer
  // belongs to. Checked through the ref so this does not fire on first render.
  useEffect(() => {
    if (shownRef.current) close();
  }, [pathname, close]);

  const stagger = (i: number) =>
    shown ? { animationDelay: `${90 + i * 55}ms` } : undefined;
  const item = (i: number) => `${ROW} ${shown ? "animate-menu-item" : ""}`;

  const drawer = (
    <div
      className={`fixed inset-0 z-[60] lg:hidden ${shown ? "" : "pointer-events-none"}`}
    >
      <div
        onClick={close}
        aria-hidden="true"
        className={`hedge-scrim absolute inset-0 bg-black/65 backdrop-blur-[3px] transition-opacity duration-300 ${
          shown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <div
        ref={panelRef}
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        className={`hedge-drawer absolute inset-y-0 right-0 flex w-[min(20rem,86vw)] flex-col border-l border-white/10 bg-[#171717] shadow-[0_0_60px_rgba(0,0,0,0.6)] outline-none transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-[calc(0.875rem+env(safe-area-inset-top))]">
          <img
            src="/logo-full.png"
            alt="Hedge"
            width={160}
            height={32}
            className="h-7 w-auto"
          />
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-muted transition hover:text-white"
          >
            <CloseGlyph />
          </button>
        </div>

        <nav className="no-scrollbar flex-1 overflow-y-auto px-2 py-2">
          <Link
            to="/token"
            prefetch="intent"
            onClick={close}
            style={stagger(0)}
            className={item(0)}
          >
            <span className="font-semibold text-gold">$HEDGE</span>
            <span className="text-gold/50">
              <ChevronRight />
            </span>
          </Link>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            onClick={close}
            style={stagger(1)}
            className={item(1)}
          >
            Docs
            <span className="text-muted">
              <ArrowUpRight />
            </span>
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            onClick={close}
            style={stagger(2)}
            className={item(2)}
          >
            Support
            <span className="text-muted">
              <ArrowUpRight />
            </span>
          </a>
          <Link
            to="/terms"
            prefetch="intent"
            onClick={close}
            style={stagger(3)}
            className={item(3)}
          >
            Terms and Conditions
            <span className="text-muted">
              <ChevronRight />
            </span>
          </Link>
        </nav>

        <div className="border-t border-white/10 px-4 pb-[calc(1.1rem+env(safe-area-inset-bottom))] pt-4">
          {authenticated ? (
            <button
              type="button"
              onClick={() => {
                close();
                onLogout();
              }}
              style={stagger(4)}
              className={`w-full rounded-full border border-white/15 bg-white/5 px-5 py-4 text-base font-semibold text-[#cfcfcf] transition active:scale-[0.98] hover:bg-white/10 hover:text-white ${
                shown ? "animate-menu-item" : ""
              }`}
            >
              Log out
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                close();
                onGetStarted();
              }}
              style={stagger(4)}
              className={`w-full rounded-full bg-gold px-5 py-4 text-base font-semibold text-black transition active:scale-[0.98] hover:brightness-105 ${
                shown ? "animate-menu-item" : ""
              }`}
            >
              Get Started
            </button>
          )}

          <div
            style={stagger(5)}
            className={shown ? "animate-menu-item" : undefined}
          >
            <p className="mt-5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#5f5f5f]">
              Follow Hedge
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {SOCIALS.map((social) => (
                <a
                  key={social.href}
                  href={social.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={social.label}
                  onClick={close}
                  className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-muted transition hover:border-white/25 hover:text-white"
                >
                  {social.icon}
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-tight text-white">
                      {social.name}
                    </span>
                    <span className="block truncate text-[11px] leading-tight">
                      {social.handle}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (shown ? close() : open())}
        aria-label={shown ? "Close menu" : "Open menu"}
        aria-expanded={shown}
        aria-controls="mobile-menu"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/10 lg:hidden"
      >
        <span className="flex h-[13.5px] w-5 flex-col justify-between">
          <span
            className={`h-[1.5px] w-5 rounded-full bg-current transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              shown ? "translate-y-[6px] rotate-45" : ""
            }`}
          />
          <span
            className={`h-[1.5px] w-5 rounded-full bg-current transition duration-200 ${
              shown ? "scale-x-0 opacity-0" : ""
            }`}
          />
          <span
            className={`h-[1.5px] w-5 rounded-full bg-current transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              shown ? "-translate-y-[6px] -rotate-45" : ""
            }`}
          />
        </span>
      </button>

      {mounted && typeof document !== "undefined"
        ? createPortal(drawer, document.body)
        : null}
    </>
  );
}
