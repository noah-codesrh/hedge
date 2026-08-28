import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import {
  useAuthorizationSignature,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import type { ConnectedWallet, User } from "@privy-io/react-auth";
import type { Route } from "./+types/profile";
import type { loader as assetsLoader } from "./api.assets";
import type { loader as portfolioLoader } from "./api.pm.portfolio";
import { HoneycombMarquee } from "../components/HoneycombMarquee";
import { useAuthModal, usePrivyMounted } from "../components/Providers";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckIcon,
  PencilIcon,
  WalletIcon,
} from "../components/icons";
import { gradientFor, readNickname, writeNickname } from "../lib/nickname";
import { trackNickname } from "../lib/track";
import { sponsoredTokenSend } from "../lib/sponsored-send";
import {
  encodeErc20Transfer,
  formatTokenAmount,
  parseTokenAmount,
  RH_EXPLORER,
  toHexQuantity,
  type ChainAsset,
} from "../lib/robinhood";
import {
  isEmbeddedWallet,
  primaryWalletAddress,
  robinhoodProvider,
  useEnsureCashWallet,
  useEnsureTradingWallet,
} from "../lib/wallet";
import { signedFiat, shorten } from "../lib/format";
import { pnlLabel, pnlTone } from "../lib/pnl";
import { knownPortfolioAddresses } from "../lib/pm-wallet";
import { deriveDepositWallet } from "../lib/pm-funder";
import { LivePositionCard } from "../components/PositionPnl";
import { LeveragePositions } from "../components/LeveragePositions";
import { PolymarketAccounts } from "../components/PolymarketAccounts";
import { ModalShell } from "../components/ModalShell";
import { SwapToCash } from "../components/SwapToCash";
import { useCloseFlow } from "../components/CloseFlow";
import { BalanceSpark, usePortfolioSpark } from "../components/BalanceSpark";
import { watchBalanceReloads } from "../lib/positions";
import { originFromMatches, siteMeta } from "../lib/seo";

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({ title: "Profile - Hedge", origin: originFromMatches(matches) });
}

function walletAccounts(user: User | null) {
  return (user?.linkedAccounts ?? []).filter(
    (account) => account.type === "wallet",
  );
}

function fiat(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function loginLabel(user: User | null) {
  if (user?.twitter) return "Signed in with X";
  if (user?.google) return "Signed in with Google";
  if (user?.discord) return "Signed in with Discord";
  if (user?.email) return "Signed in with email";
  return null;
}

function displayName(
  user: User | null,
  userId: string,
  wallet?: string | null,
) {
  const stored = readNickname(userId);
  const meta = (user?.customMetadata as { nickname?: string } | undefined)
    ?.nickname;
  const twitter = user?.twitter?.username;
  const discord = user?.discord?.username;
  const google =
    user?.google?.name || user?.google?.email?.split("@")[0];
  const email = user?.email?.address?.split("@")[0];
  return (
    stored ||
    meta ||
    twitter ||
    discord ||
    google ||
    email ||
    shorten(wallet) ||
    "Anonymous"
  );
}

export default function Profile() {
  const privyMounted = usePrivyMounted();
  if (!privyMounted) {
    return <PortfolioSkeleton />;
  }
  return <ProfileInner />;
}

function ProfileInner() {
  const { authenticated, user, ready, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { openModal } = useAuthModal();
  const assetsFetcher = useFetcher<typeof assetsLoader>();
  const portfolioFetcher = useFetcher<typeof portfolioLoader>();
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"assets" | "positions" | "activity">("assets");
  const [walletPane, setWalletPane] = useState<"polymarket" | "swap">("polymarket");
  const [posFilter, setPosFilter] = useState<"open" | "closed">("open");
  const [sendAsset, setSendAsset] = useState<ChainAsset | null>(null);
  const [sendReceipt, setSendReceipt] = useState<SendReceipt | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [nickOpen, setNickOpen] = useState(false);
  const [nickTick, setNickTick] = useState(0);
  const closeFlow = useCloseFlow();
  const { cashWallet, ensureCashWallet } = useEnsureCashWallet();
  useEnsureTradingWallet();

  const wallet = primaryWalletAddress(user, wallets);
  const userId = user?.id ?? wallet ?? "anon";
  const liveKey = wallets.map((w) => w.address.toLowerCase()).sort().join(",");

  useEffect(() => {
    if (!wallet) return;
    const load = () => {
      void assetsFetcher.load(`/api/assets?address=${wallet}`);
      const linked = walletAccounts(user);
      const signers = [
        ...linked
          .filter((w) => "address" in w)
          .map((w) => String((w as { address: string }).address)),
        ...wallets.map((w) => w.address),
      ];
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

  const copy = async (value?: string | null) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const assets = assetsFetcher.data?.assets ?? [];
  const usdg = assets.find((a) => a.symbol === "USDG");
  const openPositions = portfolioFetcher.data?.open ?? [];
  const closedPositions = portfolioFetcher.data?.closed ?? [];
  const activity = portfolioFetcher.data?.activity ?? [];
  const portfolioLoading =
    portfolioFetcher.state !== "idle" && portfolioFetcher.data == null;
  const positionsValue = portfolioFetcher.data?.positionsValue ?? 0;
  const positionsPnl = portfolioFetcher.data?.positionsPnl ?? null;
  const cash = usdg?.balance ?? 0;
  const total = cash + positionsValue;
  const spark = usePortfolioSpark(
    authenticated ? openPositions : [],
    cash,
    total,
  );

  if (!ready) return <PortfolioSkeleton />;
  if (!authenticated) return <PortfolioGate onGetStarted={openModal} />;

  const assetsError = assetsFetcher.data?.error;
  const assetsLoading = assetsFetcher.state !== "idle" && assets.length === 0;
  const nickname = displayName(user, userId, wallet);
  const signedInAs = loginLabel(user);
  void nickTick;

  const joined = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : undefined;

  const shownPositions =
    posFilter === "open" ? openPositions : closedPositions;

  const connected = wallet
    ? wallets.find((w) => w.address.toLowerCase() === wallet.toLowerCase())
    : undefined;

  return (
    <main className="mx-auto min-w-0 max-w-5xl space-y-6 px-3 pt-5 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:pt-8 lg:pb-10">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_1fr] lg:gap-6">
        <div className="flex min-w-0 flex-col rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-7">
          <div className="flex items-start gap-3 sm:gap-4">
            <div
              className="h-14 w-14 shrink-0 rounded-full ring-2 ring-white/10 sm:h-16 sm:w-16"
              style={{ background: gradientFor(wallet || userId) }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-bold sm:text-2xl">
                  {nickname}
                </h1>
                <button
                  type="button"
                  onClick={() => setNickOpen(true)}
                  className="rounded-full bg-white/5 p-1.5 text-muted transition hover:text-white"
                  aria-label="Edit nickname"
                >
                  <PencilIcon />
                </button>
              </div>
              <p className="mt-1 text-[13px] text-muted">
                {signedInAs ? `${signedInAs} · ` : null}
                {joined ? `Joined ${joined}` : "Hedge"} · {openPositions.length}{" "}
                {openPositions.length === 1 ? "prediction" : "predictions"}
              </p>
              {wallet ? (
                <button
                  type="button"
                  onClick={() => void copy(wallet)}
                  className="mt-1 font-mono text-[12px] text-muted transition hover:text-white"
                >
                  {copied ? "Copied" : shorten(wallet)}
                </button>
              ) : (
                <p className="mt-1 text-[12px] text-muted">
                  Setting up your Hedge wallet…
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!wallet}
              onClick={() => setReceiveOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gold py-3 text-sm font-semibold text-black transition hover:brightness-105 disabled:opacity-50"
            >
              <ArrowDownTrayIcon /> Receive
            </button>
            <button
              type="button"
              disabled={!wallet}
              onClick={() => setSendAsset(usdg ?? assets[0] ?? null)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-50"
            >
              <ArrowUpTrayIcon /> Send
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col rounded-3xl bg-gradient-to-br from-[#242017] via-card to-card p-5 ring-1 ring-white/5 sm:p-7">
          <span className="text-[13px] font-medium text-muted">Balance</span>
          <p className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            {assetsLoading && !usdg ? "…" : fiat(total)}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {fiat(cash)} cash
            {portfolioLoading
              ? " · …"
              : ` · ${fiat(positionsValue)} in positions`}
            {!portfolioLoading && positionsPnl != null ? (
              <span
                className={`ml-1.5 font-semibold tabular-nums ${
                  pnlTone(positionsPnl) === "up"
                    ? "text-up"
                    : pnlTone(positionsPnl) === "down"
                      ? "text-down"
                      : ""
                }`}
              >
                · {pnlLabel(positionsPnl)} {signedFiat(positionsPnl)}
              </span>
            ) : null}
          </p>
          <BalanceSpark points={spark} pnl={positionsPnl ?? 0} />
          <div className="mt-auto grid grid-cols-3 gap-2 border-t border-white/5 pt-4">
            <Stat label="Cash" value={fiat(cash)} />
            <Stat
              label="Positions"
              value={portfolioLoading ? "…" : fiat(positionsValue)}
            />
            <Stat label="Markets" value={String(openPositions.length)} />
          </div>
        </div>
      </section>

      <section className="space-y-2.5">
        <div className="inline-flex items-center gap-1 rounded-full bg-[#141414] p-1 ring-1 ring-white/5">
          {(["polymarket", "swap"] as const).map((pane) => (
            <button
              key={pane}
              type="button"
              onClick={() => setWalletPane(pane)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                walletPane === pane
                  ? "bg-white text-black"
                  : "text-muted hover:text-white"
              }`}
            >
              {pane === "polymarket" ? "Polymarket" : "Swap"}
            </button>
          ))}
        </div>

        {walletPane === "polymarket" ? (
          <PolymarketAccounts user={user} onCashOut={closeFlow.confirmCashOut} />
        ) : wallet ? (
          <SwapToCash
            address={wallet}
            wallet={cashWallet ?? undefined}
            ensureCashWallet={ensureCashWallet}
            onDone={() => void assetsFetcher.load(`/api/assets?address=${wallet}`)}
          />
        ) : null}
      </section>

      <section>
        <div className="no-scrollbar flex items-center gap-6 overflow-x-auto border-b border-white/5">
          {(["assets", "positions", "activity"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px shrink-0 border-b-2 pb-3 text-[15px] font-semibold capitalize transition ${
                tab === t
                  ? "border-white text-white"
                  : "border-transparent text-muted hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "assets" && (
          <div className="mt-5 space-y-3">
            {assetsError ? (
              <p className="rounded-2xl bg-card px-4 py-6 text-sm text-down ring-1 ring-white/5">
                {assetsError}
              </p>
            ) : assetsLoading ? (
              <p className="rounded-2xl bg-card px-4 py-10 text-center text-sm text-muted ring-1 ring-white/5">
                Loading Robinhood Chain balances…
              </p>
            ) : (
              <div className="space-y-2">
                {assets.map((asset) => (
                  <AssetRow
                    key={asset.id}
                    asset={asset}
                    onSend={() => setSendAsset(asset)}
                  />
                ))}
                {assets.length === 0 ? (
                  <p className="rounded-2xl bg-card px-4 py-10 text-center text-sm text-muted ring-1 ring-white/5">
                    Couldn’t load USDG, ETH, and WETH.
                  </p>
                ) : null}
              </div>
            )}
            <p className="text-center text-[12px] text-muted">
              {assets.length} assets on Robinhood Chain · balances from the
              live registry + explorer.
            </p>
          </div>
        )}

        {tab === "positions" && (
          <div className="mt-5">
            {/* Levered positions live on the engine, not on Polymarket, so
                they are fetched separately and sit above the spot list. */}
            {posFilter === "open" ? <LeveragePositions compact /> : null}

            <div className="flex items-center gap-2">
              {(["open", "closed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setPosFilter(f)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition ${
                    posFilter === f
                      ? "bg-white text-black"
                      : "bg-[#1e1e1e] text-[#cfcfcf] ring-1 ring-white/10"
                  }`}
                >
                  {f === "open" ? "Active" : "Closed"}
                </button>
              ))}
            </div>
            {portfolioLoading ? (
              <p className="mt-4 rounded-2xl bg-card px-4 py-12 text-center text-sm text-muted ring-1 ring-white/5">
                Loading live positions…
              </p>
            ) : shownPositions.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-card px-4 py-12 text-center ring-1 ring-white/5">
                <p className="text-[15px] text-muted">No positions found.</p>
                <Link
                  to="/"
                  className="mt-4 inline-flex rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black"
                >
                  Browse markets
                </Link>
              </div>
            ) : (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {shownPositions.map((p) => (
                  <li key={p.id} className="min-w-0">
                    <LivePositionCard
                      position={p}
                      onClose={
                        p.status === "open"
                          ? () => closeFlow.confirmClose(p)
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "activity" && (
          <div className="mt-5">
            {portfolioLoading ? (
              <p className="rounded-2xl bg-card px-4 py-12 text-center text-sm text-muted ring-1 ring-white/5">
                Loading activity…
              </p>
            ) : activity.length === 0 ? (
              <div className="rounded-2xl bg-card px-4 py-12 text-center ring-1 ring-white/5">
                <p className="text-[15px] text-muted">No activity yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl ring-1 ring-white/5">
                {activity.map((item) => {
                  const href = item.eventSlug
                    ? `/market/${item.eventSlug}`
                    : item.marketSlug
                      ? `/market/${item.marketSlug}`
                      : "/";
                  const ms =
                    item.timestamp > 1e12
                      ? item.timestamp
                      : item.timestamp * 1000;
                  return (
                    <li key={item.id}>
                      <Link
                        to={href}
                        className="flex items-center justify-between gap-3 bg-card px-4 py-3.5 transition hover:bg-white/[0.04]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm">{item.title}</p>
                          <p className="text-[12px] text-muted">
                            {item.timestamp
                              ? new Date(ms).toLocaleString()
                              : item.type}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold">
                          {item.amount > 0
                            ? `${item.amount.toFixed(2)} USDG`
                            : item.type}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {nickOpen ? (
        <NicknameModal
          current={nickname === shorten(wallet) ? "" : nickname}
          onClose={() => setNickOpen(false)}
          onSave={(value) => {
            writeNickname(userId, value);
            setNickTick((n) => n + 1);
            setNickOpen(false);
            void (async () => {
              const token = await getAccessToken().catch(() => null);
              if (token) trackNickname(token, { nickname: value, wallet });
            })();
          }}
        />
      ) : null}

      {receiveOpen && wallet ? (
        <ReceiveModal
          address={wallet}
          onCopy={() => copy(wallet)}
          copied={copied}
          onClose={() => setReceiveOpen(false)}
        />
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
            void assetsFetcher.load(`/api/assets?address=${wallet}`);
          }}
        />
      ) : null}

      {sendReceipt ? (
        <SendSuccessModal
          receipt={sendReceipt}
          onClose={() => setSendReceipt(null)}
        />
      ) : null}

      {closeFlow.overlays}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

function AssetMark({ asset }: { asset: ChainAsset }) {
  if (asset.logoUrl) {
    return (
      <img
        src={asset.logoUrl}
        alt={asset.symbol}
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        className="h-10 w-10 rounded-full bg-[#141414] object-cover"
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
      className={`grid h-10 w-10 place-items-center rounded-full text-xs font-bold ${tone}`}
    >
      {asset.symbol}
    </span>
  );
}

function AssetRow({
  asset,
  onSend,
}: {
  asset: ChainAsset;
  onSend: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#141414] px-3 py-3 ring-1 ring-white/5 sm:px-4">
      <AssetMark asset={asset} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{asset.name}</div>
        <div className="truncate text-[12px] text-muted">
          {asset.symbol} · Robinhood Chain
        </div>
      </div>
      <div className="text-right">
        <div className="text-[15px] font-semibold tabular-nums">
          {formatTokenAmount(asset.balanceRaw, asset.decimals)}
        </div>
        {asset.valueUsd != null ? (
          <div className="text-[12px] text-muted">{fiat(asset.valueUsd)}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onSend}
        className="hidden rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold text-[#cfcfcf] transition hover:text-white sm:inline"
      >
        Send
      </button>
    </div>
  );
}

function NicknameModal({
  current,
  onClose,
  onSave,
}: {
  current: string;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(current);
  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-lg font-semibold">Edit nickname</h2>
      <p className="mt-1 text-sm text-muted">
        Shown on your profile. You can change it whenever you want.
      </p>
      <input
        autoFocus
        maxLength={24}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="mankinde"
        className="mt-4 w-full rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3 outline-none focus:border-gold/60"
      />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/5 py-3 text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(value)}
          className="rounded-full bg-gold py-3 text-sm font-semibold text-black"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function ReceiveModal({
  address,
  copied,
  onCopy,
  onClose,
}: {
  address: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-lg font-semibold">Receive</h2>
      <p className="mt-1 text-sm text-muted">
        Send USDG, ETH, or WETH to this address on Robinhood Chain.
      </p>
      <p className="mt-4 break-all rounded-2xl bg-[#0f0f0f] px-4 py-3 font-mono text-[13px]">
        {address}
      </p>
      <p className="mt-2 text-[12px] text-muted">
        Network: Robinhood Chain · ETH for gas
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={`${RH_EXPLORER}/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-white/5 py-3 text-center text-sm font-semibold"
        >
          Explorer
        </a>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-full bg-gold py-3 text-sm font-semibold text-black"
        >
          {copied ? "Copied" : "Copy address"}
        </button>
      </div>
    </ModalShell>
  );
}

type SendReceipt = {
  amount: string;
  symbol: string;
  to: string;
  /** Absent when a wallet confirms the send without returning one. */
  hash: string | null;
};

function SendModal({
  asset,
  assets,
  from,
  connected,
  ensureCashWallet,
  onChangeAsset,
  onClose,
  onSent,
}: {
  asset: ChainAsset;
  assets: ChainAsset[];
  from: string;
  connected?: ConnectedWallet;
  ensureCashWallet?: () => Promise<ConnectedWallet>;
  onChangeAsset: (asset: ChainAsset) => void;
  onClose: () => void;
  onSent: (receipt: SendReceipt) => void;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getAccessToken } = usePrivy();
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const sendable = assets;

  const onSend = async () => {
    setError(null);
    if (!/^0x[a-fA-F0-9]{40}$/.test(to.trim())) {
      setError("Enter a valid 0x address.");
      return;
    }
    let qty: bigint;
    try {
      qty = parseTokenAmount(amount, asset.decimals);
    } catch {
      setError("Enter a valid amount.");
      return;
    }
    if (qty <= 0n) {
      setError("Amount must be greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const signer = connected ?? (await ensureCashWallet?.());
      if (!signer) {
        setError("Your wallet isn't ready yet. Try again in a moment.");
        setBusy(false);
        return;
      }
      const data = asset.address
        ? encodeErc20Transfer(to.trim(), qty)
        : null;
      const receipt = {
        amount: formatTokenAmount(qty.toString(), asset.decimals),
        symbol: asset.symbol,
        to: to.trim(),
      };

      // Token sends from the embedded wallet go through Privy so the app pays
      // gas. Native ETH is the gas, and external wallets pay their own.
      if (data && isEmbeddedWallet(signer.walletClientType)) {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("Session expired. Sign in again.");
        const hash = await sponsoredTokenSend({
          accessToken,
          from: signer.address,
          token: asset.address!,
          data,
          signAuthorization: async (payload) => {
            const { signature } =
              await generateAuthorizationSignature(payload);
            if (!signature) {
              throw new Error("Could not authorize this wallet.");
            }
            return signature;
          },
        });
        onSent({ ...receipt, hash });
        return;
      }

      const provider = await robinhoodProvider(signer);
      const tx = data
        ? { from, to: asset.address, data, value: "0x0" }
        : { from, to: to.trim(), value: toHexQuantity(qty) };
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [tx],
      });
      onSent({
        ...receipt,
        hash: typeof hash === "string" && hash.startsWith("0x") ? hash : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-lg font-semibold">Send</h2>
      <p className="mt-1 text-sm text-muted">
        Transfers on Robinhood Chain. Keep a little ETH for gas.
      </p>
      <label className="mt-4 block text-[12px] font-medium uppercase tracking-wide text-muted">
        Asset
      </label>
      <select
        value={asset.id}
        onChange={(e) => {
          const next = assets.find((a) => a.id === e.target.value);
          if (next) onChangeAsset(next);
        }}
        className="mt-1 w-full rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3 outline-none"
      >
        {sendable.map((a) => (
          <option key={a.id} value={a.id}>
            {a.symbol} · {formatTokenAmount(a.balanceRaw, a.decimals)}
          </option>
        ))}
      </select>
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Recipient 0x…"
        className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3 font-mono text-sm outline-none focus:border-gold/60"
      />
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={`Amount (${asset.symbol})`}
        inputMode="decimal"
        className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3 outline-none focus:border-gold/60"
      />
      <button
        type="button"
        onClick={() =>
          setAmount(formatTokenAmount(asset.balanceRaw, asset.decimals, 8))
        }
        className="mt-2 text-left text-[12px] text-gold"
      >
        Max {formatTokenAmount(asset.balanceRaw, asset.decimals)} {asset.symbol}
      </button>
      {error ? <p className="mt-3 text-sm text-down">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void onSend()}
        className="mt-4 w-full rounded-full bg-gold py-3.5 text-sm font-semibold text-black disabled:opacity-60"
      >
        {busy ? "Confirm in wallet…" : `Send ${asset.symbol}`}
      </button>
    </ModalShell>
  );
}

function SendSuccessModal({
  receipt,
  onClose,
}: {
  receipt: SendReceipt;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose}>
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#1f6f43] text-white">
          <CheckIcon size={28} />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-tight">Sent</h2>
        <p className="mt-1 text-[15px] tabular-nums text-muted">
          {receipt.amount} {receipt.symbol}
        </p>
        <p className="mt-3 text-[12px] text-muted">
          To <span className="font-mono">{shorten(receipt.to)}</span>
        </p>
      </div>
      <div className="mt-5 grid gap-2">
        {receipt.hash ? (
          <a
            href={`${RH_EXPLORER}/tx/${receipt.hash}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white/5 py-3 text-center text-sm font-semibold"
          >
            View on explorer
          </a>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-gold py-3.5 text-sm font-semibold text-black transition hover:brightness-105"
        >
          Done
        </button>
      </div>
    </ModalShell>
  );
}

const PREVIEW = [
  { label: "USDG", value: "—", hint: "Robinhood" },
  { label: "Positions", value: "0", hint: "Open" },
  { label: "PnL", value: "—", hint: "All time" },
] as const;

function PortfolioGate({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <main className="mx-auto min-w-0 max-w-lg px-3 pt-4 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:pt-8 lg:pb-10">
      <div className="overflow-hidden rounded-[28px] bg-[#1b1b1b] ring-1 ring-white/10 animate-pop-in">
        <div className="relative h-40 overflow-hidden sm:h-48">
          <HoneycombMarquee columns={3} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-[#1b1b1b]" />
          <div className="absolute inset-0 grid place-items-center">
            <img
              src="/logo-mark-dark.svg"
              alt=""
              className="h-16 w-auto drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)] sm:h-[4.5rem]"
            />
          </div>
        </div>

        <div className="px-5 pb-6 pt-1 sm:px-8 sm:pb-8">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
            Profile
          </p>
          <h1 className="mt-2 text-center text-[1.7rem] font-bold leading-[1.15] tracking-tight sm:text-3xl">
            Your book, in USDG.
          </h1>
          <p className="mx-auto mt-2.5 max-w-[20rem] text-center text-[14px] leading-relaxed text-muted sm:max-w-sm sm:text-[15px]">
            Connect a Robinhood or EVM wallet to see balance, Yes/No positions,
            and activity.
          </p>

          <div className="mt-6 grid grid-cols-3 gap-2">
            {PREVIEW.map((item, i) => (
              <div
                key={item.label}
                className="animate-card-in rounded-2xl bg-white/[0.04] px-1.5 py-3 text-center ring-1 ring-white/5 sm:px-2"
                style={{ animationDelay: `${90 + i * 70}ms` }}
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  {item.label}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                  {item.value}
                </p>
                <p className="mt-0.5 text-[10px] text-[#6b6b6b]">{item.hint}</p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onGetStarted}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3.5 text-[15px] font-semibold text-black shadow-[0_0_28px_rgba(241,214,90,0.28)] transition hover:brightness-105"
          >
            <WalletIcon size={18} />
            Get Started
          </button>
          <Link
            to="/"
            className="mt-3 block text-center text-sm font-medium text-muted transition hover:text-white"
          >
            Browse markets
          </Link>
        </div>
      </div>
    </main>
  );
}

function PortfolioSkeleton() {
  return (
    <main className="mx-auto min-w-0 max-w-lg px-3 pt-4 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:pt-8">
      <div className="overflow-hidden rounded-[28px] bg-[#1b1b1b] ring-1 ring-white/10">
        <div className="h-40 bg-gold/40 sm:h-48" />
        <div className="space-y-3 px-5 py-8 sm:px-8">
          <div className="mx-auto h-3 w-24 rounded-full bg-white/10" />
          <div className="mx-auto h-7 w-48 rounded-full bg-white/10" />
          <div className="mx-auto h-4 w-64 max-w-full rounded-full bg-white/5" />
        </div>
      </div>
    </main>
  );
}
