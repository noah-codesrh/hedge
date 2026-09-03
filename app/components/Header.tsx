import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Form, Link, useLocation, useSearchParams } from "react-router";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { DepositButton, useBook } from "./Book";
import { FlameIcon, PiggyBankIcon, SearchIcon, WalletIcon } from "./icons";
import { MobileMenu } from "./MobileMenu";
import { fiat } from "../lib/format";

function SearchBar() {
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = params.get("q") ?? "";
  const tag = params.get("tag");
  const sort = params.get("sort");
  const section = params.get("section");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Form
      key={`${tag}-${sort}-${section}-${q}`}
      action="/"
      method="get"
      className="mx-auto hidden min-w-0 flex-1 max-w-md items-center gap-2.5 rounded-full border border-white/10 bg-[#1e1e1e] px-4 py-2.5 md:flex"
    >
      {tag ? <input type="hidden" name="tag" value={tag} /> : null}
      {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      {section ? <input type="hidden" name="section" value={section} /> : null}
      <SearchIcon />
      <input
        ref={inputRef}
        name="q"
        defaultValue={q}
        placeholder="Search markets"
        className="w-full bg-transparent text-sm text-white placeholder-muted outline-none"
      />
      <kbd className="text-base font-medium text-muted">/</kbd>
    </Form>
  );
}

function HeaderShell({
  authenticated,
  onGetStarted,
  onLogout,
  book,
}: {
  authenticated: boolean;
  onGetStarted: () => void;
  onLogout: () => void;
  book?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 min-w-0 max-w-7xl items-center gap-2 px-3 sm:h-16 sm:gap-3 lg:gap-4">
        <Link to="/" prefetch="intent" className="shrink-0">
          <img
            src="/logo-full.png"
            alt="Hedge"
            width={160}
            height={32}
            fetchPriority="high"
            decoding="async"
            className="h-7 w-auto max-w-[118px] sm:h-8 sm:max-w-none"
          />
        </Link>

        <nav className="hidden shrink-0 items-center gap-0.5 lg:flex">
          <Link
            to="/"
            prefetch="intent"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
          >
            Markets
          </Link>
          <Link
            to="/earn"
            prefetch="intent"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
          >
            Earn
          </Link>
          <Link
            to="/rewards"
            prefetch="intent"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
          >
            Rewards
          </Link>
          <Link
            to="/wall"
            prefetch="intent"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
          >
            Wall
          </Link>
          <Link
            to="/token"
            prefetch="intent"
            className="rounded-full px-3 py-1.5 text-sm font-semibold text-gold transition hover:bg-gold/10"
          >
            $HEDGE
          </Link>
          {authenticated && (
            <Link
              to="/profile"
              prefetch="intent"
              className="rounded-full px-3 py-1.5 text-sm font-medium text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
            >
              Profile
            </Link>
          )}
        </nav>

        <SearchBar />

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            to="/ai"
            prefetch="intent"
            aria-label="Hedgie"
            title="Ask Hedgie"
            className="group relative grid h-10 w-10 place-items-center rounded-full ring-1 ring-white/10 transition hover:ring-gold/60"
          >
            <span className="absolute inset-0 rounded-full bg-gold/20 opacity-0 blur-md transition group-hover:opacity-100" />
            <img
              src="/hedgie-ai-tag.jpg"
              alt="Hedgie"
              className="animate-hedgie-nudge h-8 w-8 rounded-full object-cover"
            />
          </Link>
          {authenticated ? (
            <>
              {book ? <HeaderBook /> : null}
              {book ? <DepositButton /> : null}
              <button
                onClick={onLogout}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[#cfcfcf] transition hover:bg-white/10 hover:text-white sm:px-4 sm:py-2 sm:text-sm"
              >
                Log out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onGetStarted}
              className="rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-105 sm:px-5 sm:py-2 sm:text-sm"
            >
              Get Started
            </button>
          )}

          <MobileMenu
            authenticated={authenticated}
            onGetStarted={onGetStarted}
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  );
}

function HeaderBook() {
  const { cash, portfolio } = useBook();
  return (
    <>
      <Link
        to="/profile"
        className="hidden items-center gap-4 pr-1 md:flex"
      >
        <span className="text-right">
          <span className="block text-[11px] leading-none text-muted">
            Portfolio
          </span>
          <span className="mt-1 block text-sm font-semibold tabular-nums">
            {fiat(portfolio)}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[11px] leading-none text-muted">Cash</span>
          <span className="mt-1 block text-sm font-semibold tabular-nums">
            {fiat(cash)}
          </span>
        </span>
      </Link>
      <Link to="/profile" className="text-right md:hidden">
        <span className="block text-[10px] leading-none text-muted">
          Portfolio
        </span>
        <span className="mt-0.5 block text-sm font-semibold tabular-nums">
          {fiat(portfolio)}
        </span>
      </Link>
    </>
  );
}

function PrivyHeader() {
  const { authenticated, logout } = usePrivy();
  const { openModal } = useAuthModal();

  return (
    <HeaderShell
      authenticated={authenticated}
      onGetStarted={openModal}
      onLogout={logout}
      book
    />
  );
}

function MobileTab({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={href}
      prefetch="render"
      className={`flex flex-1 flex-col items-center gap-1 py-1 text-[10px] font-medium transition ${
        active ? "text-gold" : "text-muted"
      }`}
    >
      {children}
      <span>{label}</span>
    </Link>
  );
}

function MobileTabBar() {
  const { pathname } = useLocation();
  const isMarkets = pathname === "/" || pathname.startsWith("/market");
  const isProfile = pathname.startsWith("/profile");
  const isEarn = pathname.startsWith("/earn");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <div className="grid grid-cols-3 items-end border-t border-white/10 bg-[#161616]/95 px-2 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] backdrop-blur-xl">
        <MobileTab href="/earn" label="Earn" active={isEarn}>
          <PiggyBankIcon size={22} />
        </MobileTab>

        <Link
          to="/"
          prefetch="render"
          className="flex flex-col items-center gap-1"
          aria-label="Markets"
        >
          <span
            className={`-mt-8 grid h-12 w-12 place-items-center rounded-full text-black shadow-lg shadow-gold/30 ring-4 ring-[#161616] transition ${
              isMarkets ? "bg-gold" : "bg-gold/90"
            }`}
          >
            <FlameIcon size={24} />
          </span>
          <span
            className={`text-[10px] font-semibold ${isMarkets ? "text-gold" : "text-muted"}`}
          >
            Markets
          </span>
        </Link>

        <MobileTab href="/profile" label="Profile" active={isProfile}>
          <WalletIcon size={22} />
        </MobileTab>
      </div>
    </nav>
  );
}

export function Header() {
  const { openModal } = useAuthModal();
  const privyMounted = usePrivyMounted();
  return (
    <>
      {privyMounted ? (
        <PrivyHeader />
      ) : (
        <HeaderShell
          authenticated={false}
          onGetStarted={openModal}
          onLogout={() => {}}
        />
      )}
      <MobileTabBar />
    </>
  );
}
