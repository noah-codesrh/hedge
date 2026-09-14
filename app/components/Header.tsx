import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Form, Link, useLocation, useSearchParams } from "react-router";
import { forgetAccessToken } from "../lib/privy-session";
import {
  sessionStillHeld,
  useHeldSession,
  writeSessionHint,
} from "../lib/session-hint";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { useBook } from "./Book";
import { ReferralBind } from "./ReferralCapture";
import { ChevronDownIcon, FlameIcon, PiggyBankIcon, SearchIcon, WalletIcon } from "./icons";
import { InstallHedge } from "./InstallHedge";
import { useI18n, useT } from "./I18n";
import { LanguageTrigger } from "./LanguagePicker";
import { HeaderMarketNav } from "./MarketNav";
import { AccountMenu } from "./AccountMenu";
import { MobileMenu } from "./MobileMenu";
import { PoolBanner } from "./PoolBanner";
import { fiat } from "../lib/format";

function SearchBar() {
  const t = useT();
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
      className="hidden min-w-0 w-[322px] items-center gap-2.5 rounded-full border border-white/10 bg-[#1e1e1e] px-[17px] py-0.5 lg:flex"
    >
      {tag ? <input type="hidden" name="tag" value={tag} /> : null}
      {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      {section ? <input type="hidden" name="section" value={section} /> : null}
      <SearchIcon size={16} />
      <input
        ref={inputRef}
        name="q"
        defaultValue={q}
        placeholder={t("nav.searchMarkets")}
        className="w-full bg-transparent text-sm text-white placeholder-muted outline-none"
      />
      <kbd className="font-mono text-base text-muted">/</kbd>
    </Form>
  );
}

function HeaderShell({
  authenticated,
  onGetStarted,
  onLogout,
  onAddHome,
  book,
}: {
  authenticated: boolean;
  onGetStarted: () => void;
  onLogout: () => void;
  onAddHome?: () => void;
  book?: boolean;
}) {
  const t = useT();
  const { pathname } = useLocation();
  const { openLanguagePicker } = useI18n();
  const { openDeposit } = useBook();
  const onMarkets = pathname === "/";
  return (
    <header className="sticky top-0 z-40 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-[8px]">
      <PoolBanner />
      <div className="border-b border-white/15 bg-black/30">
        <div className="mx-auto flex h-14 min-w-0 max-w-[1256px] items-center justify-between gap-4 px-3 sm:h-[67px]">
          <div className="flex min-w-0 items-center gap-4">
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

            <nav className="hidden shrink-0 items-center gap-[26px] px-3 lg:flex">
              <Link
                to="/"
                prefetch="intent"
                className="text-sm font-medium text-[#cfcfcf] transition hover:text-white"
              >
                {t("nav.markets")}
              </Link>
              <Link
                to="/earn"
                prefetch="intent"
                className="text-sm font-medium text-[#cfcfcf] transition hover:text-white"
              >
                {t("nav.earn")}
              </Link>
              <Link
                to="/rewards"
                prefetch="intent"
                className="text-sm font-medium text-[#cfcfcf] transition hover:text-white"
              >
                {t("nav.rewards")}
              </Link>
              <Link
                to="/token"
                prefetch="intent"
                className="text-sm font-semibold text-gold transition hover:text-gold-soft"
              >
                $HEDGE
              </Link>
              <MoreMenu
                authenticated={authenticated}
                onLanguage={openLanguagePicker}
              />
            </nav>

            <SearchBar />
          </div>

          <div className="relative z-10 flex shrink-0 items-center gap-3">
            {authenticated ? (
              <>
                {book ? (
                  <button
                    type="button"
                    onClick={openDeposit}
                    className="rounded-full bg-gold px-2.5 py-1.5 text-sm font-semibold leading-5 text-black transition hover:brightness-105"
                  >
                    {t("nav.deposit")}
                  </button>
                ) : null}
                {book ? <HeaderCash /> : null}
              </>
            ) : (
              <button
                type="button"
                onClick={onGetStarted}
                className="rounded-full bg-gold px-2.5 py-1.5 text-sm font-semibold leading-5 text-black transition hover:brightness-105"
              >
                {t("nav.logIn")}
              </button>
            )}
            <LanguageTrigger compact />
            {authenticated ? <AccountMenu onLogout={onLogout} /> : null}
            <MobileMenu
              authenticated={authenticated}
              onGetStarted={onGetStarted}
              onLogout={onLogout}
              onAddHome={onAddHome}
            />
          </div>
        </div>
      </div>
      {onMarkets ? (
        <>
          <div className="mx-auto hidden w-full max-w-[1256px] px-3 pb-1.5 pt-1 lg:block">
            <HeaderMarketNav />
          </div>
          <div className="border-b border-white/10 px-3 pb-2 pt-2 lg:hidden">
            <HeaderMarketNav />
          </div>
        </>
      ) : null}
    </header>
  );
}

function MoreMenu({
  authenticated,
  onLanguage,
}: {
  authenticated: boolean;
  onLanguage: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "block w-full px-3 py-2 text-left text-sm text-[#cfcfcf] transition hover:bg-white/5 hover:text-white";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-sm font-medium text-[#cfcfcf] transition hover:text-white"
      >
        {t("nav.more")}
        <ChevronDownIcon size={12} />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 min-w-[180px] overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] py-1 shadow-xl">
          <Link
            to="/pool"
            prefetch="intent"
            className={item}
            onClick={() => setOpen(false)}
          >
            {t("nav.pool")}
          </Link>
          <Link
            to="/wall"
            prefetch="intent"
            className={item}
            onClick={() => setOpen(false)}
          >
            {t("nav.wall")}
          </Link>
          {authenticated ? (
            <Link
              to="/profile"
              prefetch="intent"
              className={item}
              onClick={() => setOpen(false)}
            >
              {t("nav.profile")}
            </Link>
          ) : null}
          <Link
            to="/roadmap"
            prefetch="intent"
            className={item}
            onClick={() => setOpen(false)}
          >
            {t("menu.roadmap")}
          </Link>
          <Link
            to="/ai"
            prefetch="intent"
            className={item}
            onClick={() => setOpen(false)}
          >
            {t("nav.hedgie")}
          </Link>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onLanguage();
            }}
          >
            {t("menu.language")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HeaderCash() {
  const { cash } = useBook();
  return (
    <div className="hidden items-center gap-2.5 sm:flex">
      <Link
        to="/profile"
        prefetch="intent"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-white"
      >
        <WalletIcon size={20} />
        <span className="tabular-nums">{fiat(cash)}</span>
      </Link>
      <span aria-hidden className="h-[17px] w-px bg-white/20" />
      <Link
        to="/ai"
        prefetch="intent"
        aria-label="Hedgie"
        className="grid h-7 w-7 place-items-center overflow-hidden rounded-full"
      >
        <img
          src="/hedgie-ai-tag.jpg"
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 rounded-full object-cover"
        />
      </Link>
    </div>
  );
}

function PrivyHeader({
  hinted,
  onHinted,
  onAddHome,
}: {
  hinted: boolean;
  onHinted: (on: boolean) => void;
  onAddHome?: () => void;
}) {
  const { authenticated, ready, logout } = usePrivy();
  const { openModal } = useAuthModal();
  const held = useHeldSession(authenticated, ready);
  const signedIn = authenticated || held;

  useEffect(() => {
    onHinted(signedIn);
  }, [onHinted, signedIn]);

  const onLogout = () => {
    forgetAccessToken();
    writeSessionHint(false);
    onHinted(false);
    void logout();
  };

  return (
    <>
      <ReferralBind />
      <HeaderShell
        authenticated={signedIn}
        onGetStarted={openModal}
        onLogout={onLogout}
        onAddHome={onAddHome}
        book={authenticated}
      />
    </>
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
  const t = useT();
  const { pathname } = useLocation();
  const isMarkets = pathname === "/" || pathname.startsWith("/market");
  const isProfile = pathname.startsWith("/profile");
  const isEarn = pathname.startsWith("/earn");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <div className="grid grid-cols-3 items-end border-t border-white/10 bg-[#161616]/95 px-2 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] backdrop-blur-xl">
        <MobileTab href="/earn" label={t("nav.earn")} active={isEarn}>
          <PiggyBankIcon size={22} />
        </MobileTab>

        <Link
          to="/"
          prefetch="render"
          className="flex flex-col items-center gap-1"
          aria-label={t("nav.markets")}
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
            {t("nav.markets")}
          </span>
        </Link>

        <MobileTab href="/profile" label={t("nav.profile")} active={isProfile}>
          <WalletIcon size={22} />
        </MobileTab>
      </div>
    </nav>
  );
}

export function Header() {
  const { openModal } = useAuthModal();
  const privyMounted = usePrivyMounted();
  const [hinted, setHinted] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  useLayoutEffect(() => {
    setHinted(sessionStillHeld());
  }, []);

  return (
    <>
      {privyMounted ? (
        <PrivyHeader
          hinted={hinted}
          onHinted={setHinted}
          onAddHome={() => setInstallOpen(true)}
        />
      ) : (
        <HeaderShell
          authenticated={hinted}
          onGetStarted={openModal}
          onLogout={() => {
            writeSessionHint(false);
            setHinted(false);
          }}
          onAddHome={() => setInstallOpen(true)}
        />
      )}
      <InstallHedge
        force={installOpen}
        onClose={() => setInstallOpen(false)}
      />
      <MobileTabBar />
    </>
  );
}
