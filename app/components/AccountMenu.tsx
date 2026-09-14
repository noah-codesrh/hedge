import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useFetcher, useLocation } from "react-router";
import { usePrivy, useWallets, type User } from "@privy-io/react-auth";
import type { loader as assetsLoader } from "../routes/api.assets";
import type { loader as portfolioLoader } from "../routes/api.pm.portfolio";
import { useBook } from "./Book";
import { useT } from "./I18n";
import { ModalShell } from "./ModalShell";
import { usePrivyMounted } from "./Providers";
import { liveHref } from "./PnlShareCard";
import { SendModal, SendSuccessModal, type SendReceipt } from "./SendAssets";
import { SwapToCash } from "./SwapToCash";
import { fiat, shorten } from "../lib/format";
import { identityName } from "../lib/nickname";
import { watchBalanceReloads } from "../lib/positions";
import {
  activityAmountLabel,
  activityHref,
  activityWhen,
  mergeActivity,
} from "../lib/polymarket-portfolio";
import { knownPortfolioAddresses } from "../lib/pm-wallet";
import { listLocalWalletActivity } from "../lib/wallet-activity";
import { deriveDepositWallet } from "../lib/pm-funder";
import { pnlTone } from "../lib/pnl";
import { formatTokenAmount, type ChainAsset } from "../lib/robinhood";
import {
  isEmbeddedWallet,
  primaryWalletAddress,
  useEnsureCashWallet,
} from "../lib/wallet";

type Tab = "positions" | "assets" | "activity";

function accountLabel(user: User | null, wallet?: string | null) {
  const name = identityName(user) || shorten(wallet) || "Anonymous";
  if (name === "Anonymous" || /\s/.test(name)) return name;
  return name.startsWith("@") ? name : `@${name}`;
}

function AssetMark({
  asset,
  size,
}: {
  asset: ChainAsset;
  size: number;
}) {
  const [broken, setBroken] = useState(false);
  if (asset.logoUrl && !broken) {
    return (
      <img
        src={asset.logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  const tone =
    asset.kind === "stable"
      ? "bg-gold/20 text-gold"
      : asset.kind === "native"
        ? "bg-white/10 text-white"
        : "bg-[#627eea]/20 text-[#8ea2ff]";
  return (
    <span
      style={{ width: size, height: size, fontSize: size < 24 ? 8 : 12 }}
      className={`grid shrink-0 place-items-center rounded-full font-bold ${tone}`}
    >
      {asset.symbol.slice(0, 2)}
    </span>
  );
}

function IconAsset({
  name,
  width,
  height,
}: {
  name: "close" | "logout" | "deposit" | "swap" | "send" | "chevron";
  width: number;
  height: number;
}) {
  return (
    <img
      src={`/icons/account/${name}.svg`}
      alt=""
      width={width}
      height={height}
      className="block max-w-none"
    />
  );
}

function HamburgerButton({
  open,
  onClick,
  label,
  buttonRef,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={open}
      aria-controls="account-menu"
      className="hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/10 lg:grid"
    >
      <span className="flex h-[13.5px] w-5 flex-col justify-between">
        <span className="h-[1.5px] w-5 rounded-full bg-current" />
        <span className="h-[1.5px] w-5 rounded-full bg-current" />
        <span className="h-[1.5px] w-5 rounded-full bg-current" />
      </span>
    </button>
  );
}

export function AccountMenu({ onLogout }: { onLogout: () => void }) {
  const t = useT();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      if (panelRef.current?.contains(node)) return;
      if (buttonRef.current?.contains(node)) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    const { style } = document.body;
    const overflowY = style.overflowY;
    style.overflowY = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
      style.overflowY = overflowY;
    };
  }, [open, close]);

  return (
    <>
      <HamburgerButton
        open={open}
        onClick={() => setOpen((v) => !v)}
        label={open ? t("menu.close") : t("menu.account")}
        buttonRef={buttonRef}
      />
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[45]">
              <div
                aria-hidden
                className="absolute inset-0 bg-black/25"
                onClick={close}
              />
              <div
                ref={panelRef}
                id="account-menu"
                role="dialog"
                aria-modal="true"
                aria-label={t("menu.account")}
                className="absolute bottom-3 right-3 top-[calc(env(safe-area-inset-top)+2rem)] flex items-start gap-2.5 outline-none"
              >
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("menu.close")}
                  className="mt-2.5 grid size-5 shrink-0 place-items-center"
                >
                  <IconAsset name="close" width={20} height={20} />
                </button>
                <div className="flex h-full w-[min(518px,calc(100vw-4.5rem))] flex-col overflow-hidden rounded-[20px] border border-white/10 bg-bg">
                  <AccountPanel onLogout={onLogout} onClose={close} />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function AccountPanel({
  onLogout,
  onClose,
}: {
  onLogout: () => void;
  onClose: () => void;
}) {
  const privyMounted = usePrivyMounted();
  if (!privyMounted) return <AccountPanelSkeleton />;
  return <AccountPanelLive onLogout={onLogout} onClose={onClose} />;
}

function AccountPanelSkeleton() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted">
      Loading…
    </div>
  );
}

function AccountPanelLive({
  onLogout,
  onClose,
}: {
  onLogout: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { cash, portfolio, openPositions, openDeposit, refresh } = useBook();
  const { cashWallet, ensureCashWallet } = useEnsureCashWallet();
  const assetsFetcher = useFetcher<typeof assetsLoader>();
  const portfolioFetcher = useFetcher<typeof portfolioLoader>();
  const [tab, setTab] = useState<Tab>("positions");
  const [chipsOpen, setChipsOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [sendAsset, setSendAsset] = useState<ChainAsset | null>(null);
  const [sendReceipt, setSendReceipt] = useState<SendReceipt | null>(null);

  const wallet = primaryWalletAddress(user, wallets);
  const liveKey = wallets.map((w) => w.address.toLowerCase()).sort().join(",");

  useEffect(() => {
    if (!wallet) return;
    const load = () => {
      const linked = (user?.linkedAccounts ?? []).filter(
        (account) => account.type === "wallet",
      );
      const signers = [
        wallet,
        ...linked
          .filter((w) => "address" in w)
          .map((w) => String((w as { address: string }).address)),
        ...wallets.map((w) => w.address),
      ];
      void assetsFetcher.load(
        `/api/assets?addresses=${encodeURIComponent(
          knownPortfolioAddresses(signers).join(","),
        )}`,
      );
      const derived = [
        ...linked
          .filter(
            (w) =>
              "address" in w && isEmbeddedWallet(w.walletClientType),
          )
          .map((w) =>
            deriveDepositWallet(String((w as { address: string }).address)),
          ),
        ...wallets
          .filter((w) => isEmbeddedWallet(w.walletClientType))
          .map((w) => deriveDepositWallet(w.address)),
      ];
      const owners = knownPortfolioAddresses([wallet, ...signers, ...derived]);
      if (owners.length > 0) {
        void portfolioFetcher.load(
          `/api/pm/portfolio?addresses=${encodeURIComponent(owners.join(","))}`,
        );
      }
    };
    return watchBalanceReloads(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, liveKey, user?.id]);

  const assets = assetsFetcher.data?.assets ?? [];
  const valued = [...assets]
    .filter((a) => (a.valueUsd ?? 0) > 0 || a.balance > 0)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const chips = valued.slice(0, 3);
  const usdg = assets.find((a) => a.symbol === "USDG");
  const activity = mergeActivity(
    listLocalWalletActivity(),
    portfolioFetcher.data?.activity ?? [],
  );
  const portfolioLoading =
    portfolioFetcher.state !== "idle" && portfolioFetcher.data == null;
  const assetsLoading =
    assetsFetcher.state !== "idle" && assets.length === 0;
  const connected = wallet
    ? wallets.find((w) => w.address.toLowerCase() === wallet.toLowerCase())
    : undefined;

  const name = accountLabel(user, wallet);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 px-0 pt-2.5">
        <div className="px-[11px]">
          <div className="flex items-center gap-2.5 rounded-[10px] bg-white/5 px-2.5 py-4">
            <div className="flex min-w-0 flex-1 items-center gap-[11px]">
              <div className="size-[69px] shrink-0 rounded-full bg-gradient-to-b from-[#a0eee9] to-[#449df7]" />
              <div className="min-w-0">
                <p className="truncate text-2xl font-semibold leading-5 text-white">
                  {name}
                </p>
                <p className="mt-3 text-sm font-medium leading-5 text-[#cfcfcf]/60">
                  {wallet ? shorten(wallet) : "—"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="inline-flex shrink-0 items-center gap-[5px] text-sm font-medium leading-5 text-down"
            >
              <IconAsset name="logout" width={20} height={20} />
              {t("nav.logOut")}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 px-2.5">
            <div className="flex items-center gap-7">
              <div className="w-[66px]">
                <p className="text-base font-semibold leading-5">{t("nav.portfolio")}</p>
                <p className="mt-[5px] text-[13px] leading-[17.88px] text-[#d8d8d8]">
                  {fiat(portfolio)}
                </p>
              </div>
              <div className="w-[43px]">
                <p className="text-base font-semibold leading-5">{t("nav.cash")}</p>
                <p className="mt-[5px] text-[13px] leading-[17.88px] text-[#d8d8d8]">
                  {fiat(cash)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setChipsOpen((v) => !v)}
              className="flex min-w-0 items-center gap-[13px] rounded-[6px] border border-white/10 px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {chips.length === 0 ? (
                  <span className="text-sm font-medium text-[#cfcfcf]">
                    {assetsLoading ? "…" : fiat(0)}
                  </span>
                ) : (
                  chips.map((asset, i) => (
                    <span key={asset.id} className="flex items-center">
                      {i > 0 ? (
                        <span
                          aria-hidden
                          className="mx-1.5 h-[17px] w-px bg-white/20"
                        />
                      ) : null}
                      <span className="flex items-center gap-[5px]">
                        <AssetMark asset={asset} size={20} />
                        <span className="text-sm font-medium leading-5 text-[#cfcfcf] tabular-nums">
                          {fiat(asset.valueUsd ?? 0)}
                        </span>
                      </span>
                    </span>
                  ))
                )}
              </span>
              <span className="border-l border-white/20 pl-2.5">
                <span className={chipsOpen ? "inline-block rotate-180" : undefined}>
                  <IconAsset name="chevron" width={8.70711} height={17} />
                </span>
              </span>
            </button>
          </div>

          {chipsOpen ? (
            <ul className="mx-2.5 max-h-40 overflow-y-auto rounded-[6px] border border-white/10">
              {valued.map((asset) => (
                <li
                  key={asset.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AssetMark asset={asset} size={20} />
                    <span className="truncate text-sm text-[#cfcfcf]">
                      {asset.symbol}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-[#cfcfcf]">
                    {fiat(asset.valueUsd ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex gap-2.5 px-2.5">
            <button
              type="button"
              onClick={openDeposit}
              className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-[6px] bg-gold p-2.5 text-black"
            >
              <IconAsset name="deposit" width={14} height={14} />
              <span className="text-sm font-semibold leading-5">
                {t("nav.deposit")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSwapOpen(true)}
              className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-[6px] bg-gold p-2.5 text-black"
            >
              <IconAsset name="swap" width={14} height={14} />
              <span className="text-sm font-semibold leading-5">
                {t("nav.swap")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSendAsset(usdg ?? assets[0] ?? null)}
              className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-[6px] bg-gold p-2.5 text-black"
            >
              <IconAsset name="send" width={14} height={14} />
              <span className="text-sm font-semibold leading-5">
                {t("nav.send")}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 px-2.5">
          {(
            [
              ["positions", t("nav.positions")],
              ["assets", t("nav.assets")],
              ["activity", t("nav.activity")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-2.5 py-1 text-sm font-semibold leading-6 ${
                tab === id
                  ? "border-b border-white text-white"
                  : "text-white/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/10">
          {tab === "positions" ? (
            portfolioLoading && openPositions.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Loading live positions…
              </p>
            ) : openPositions.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-muted">No positions found.</p>
                <Link
                  to="/"
                  onClick={onClose}
                  className="mt-3 inline-flex rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black"
                >
                  {t("nav.markets")}
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {openPositions.map((p) => {
                  const tone = pnlTone(p.pnl);
                  const color =
                    tone === "up"
                      ? "text-up"
                      : tone === "down"
                        ? "text-down"
                        : "text-muted";
                  return (
                    <li key={p.id}>
                      <Link
                        to={liveHref(p)}
                        onClick={onClose}
                        className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">
                            {p.title}
                          </p>
                          <p className="text-[12px] text-muted">
                            {p.outcome}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[13px] font-semibold tabular-nums ${color}`}
                        >
                          {fiat(p.currentValue)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}

          {tab === "assets" ? (
            assetsLoading ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Loading balances…
              </p>
            ) : assets.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                No assets yet.
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {assets.map((asset) => (
                  <li key={asset.id}>
                    <button
                      type="button"
                      onClick={() => setSendAsset(asset)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04]"
                    >
                      <AssetMark asset={asset} size={20} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">
                          {asset.symbol}
                        </p>
                        <p className="text-[12px] text-muted">
                          {formatTokenAmount(asset.balanceRaw, asset.decimals)}
                        </p>
                      </div>
                      <span className="text-[13px] font-semibold tabular-nums">
                        {asset.valueUsd != null ? fiat(asset.valueUsd) : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {tab === "activity" ? (
            portfolioLoading ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Loading activity…
              </p>
            ) : activity.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                No activity yet.
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {activity.map((item) => {
                  const href = activityHref(item);
                  const external = href.startsWith("http");
                  const row = (
                    <>
                      <div className="min-w-0">
                        <p className="truncate text-[13px]">{item.title}</p>
                        <p className="text-[12px] text-muted">
                          {activityWhen(item.timestamp) || item.type}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-[13px] font-semibold tabular-nums ${
                          item.type === "RECEIVE"
                            ? "text-up"
                            : item.type === "SEND"
                              ? "text-down"
                              : ""
                        }`}
                      >
                        {activityAmountLabel(item)}
                      </span>
                    </>
                  );
                  const cls =
                    "flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-white/[0.04]";
                  return (
                    <li key={item.id}>
                      {external ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          onClick={onClose}
                          className={cls}
                        >
                          {row}
                        </a>
                      ) : (
                        <Link to={href} onClick={onClose} className={cls}>
                          {row}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </div>
      </div>

      {swapOpen && wallet ? (
        <ModalShell onClose={() => setSwapOpen(false)}>
          <h2 className="text-lg font-semibold">{t("nav.swap")}</h2>
          <p className="mt-1 text-sm text-muted">
            Turn holdings on Robinhood Chain into USDG.
          </p>
          <div className="mt-4">
            <SwapToCash
              address={wallet}
              wallet={cashWallet ?? undefined}
              ensureCashWallet={ensureCashWallet}
              onDone={() => {
                setSwapOpen(false);
                refresh();
              }}
            />
          </div>
        </ModalShell>
      ) : null}

      {sendAsset && wallet ? (
        <SendModal
          asset={sendAsset}
          assets={assets}
          from={wallet}
          connected={connected}
          ensureCashWallet={ensureCashWallet}
          onChangeAsset={setSendAsset}
          onClose={() => setSendAsset(null)}
          onSent={(receipt) => {
            setSendAsset(null);
            setSendReceipt(receipt);
            refresh();
          }}
        />
      ) : null}

      {sendReceipt ? (
        <SendSuccessModal
          receipt={sendReceipt}
          onClose={() => setSendReceipt(null)}
        />
      ) : null}
    </div>
  );
}
