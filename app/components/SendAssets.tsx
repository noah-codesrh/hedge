import { useState } from "react";
import {
  useAuthorizationSignature,
  usePrivy,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import { CheckIcon } from "./icons";
import { ModalShell } from "./ModalShell";
import { shorten } from "../lib/format";
import { requireAccessToken } from "../lib/privy-session";
import { sponsoredTokenSend } from "../lib/sponsored-send";
import {
  encodeErc20Transfer,
  formatTokenAmount,
  parseTokenAmount,
  RH_EXPLORER,
  toHexQuantity,
  type ChainAsset,
} from "../lib/robinhood";
import { isEmbeddedWallet, robinhoodProvider } from "../lib/wallet";
import { recordWalletTx } from "../lib/wallet-activity";

export type SendReceipt = {
  amount: string;
  symbol: string;
  to: string;
  /** Absent when a wallet confirms the send without returning one. */
  hash: string | null;
};

export function SendModal({
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
      const amountLabel = formatTokenAmount(qty.toString(), asset.decimals);
      const receipt = {
        amount: amountLabel,
        symbol: asset.symbol,
        to: to.trim(),
      };
      const noteSend = (hash: string | null) => {
        recordWalletTx({
          type: "SEND",
          symbol: asset.symbol,
          amount: Number(amountLabel),
          counterparty: to.trim(),
          hash,
        });
      };

      // Token sends from the embedded wallet go through Privy so the app pays
      // gas. Native ETH is the gas, and external wallets pay their own.
      if (data && isEmbeddedWallet(signer.walletClientType)) {
        const accessToken = await requireAccessToken(getAccessToken);
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
        noteSend(hash);
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
      const confirmed =
        typeof hash === "string" && hash.startsWith("0x") ? hash : null;
      noteSend(confirmed);
      onSent({
        ...receipt,
        hash: confirmed,
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
        {assets.map((a) => (
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

export function SendSuccessModal({
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
