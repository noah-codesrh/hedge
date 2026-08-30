import { useCallback, useState } from "react";
import {
  useAddFunds,
  useAuthorizationSignature,
  useFundWallet,
  usePrivy,
} from "@privy-io/react-auth";
import { useAuthModal } from "../components/auth-modal";
import { convertOnrampToCash } from "./cash-in";
import { base } from "./chains";
import { notifyBalancesChanged } from "./positions";
import { useEnsureTradingWallet } from "./wallet";

/**
 * Stripe, Coinbase, and MoonPay cannot buy USDG on Robinhood. Each onramp
 * lands USDC on Base; we then convert that to USDG cash.
 */
export const FUND_DEST_CHAIN = "eip155:8453" as const;
export const FUND_DEST_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const FUND_DEFAULT_AMOUNT = "50";

export type FundProvider = "stripe" | "coinbase" | "moonpay";
export type FundPhase = "onramp" | "wait" | "convert";

export function isFundingDismissed(err: unknown) {
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");
  return /cancel|closed|exited|dismiss|abort|user.?reject/i.test(message);
}

function fundingMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Funding did not complete. Try again.";
}

async function usdgBalance(address: string) {
  const res = await fetch(`/api/assets?address=${encodeURIComponent(address)}`);
  const data = (await res.json().catch(() => null)) as {
    assets?: { symbol: string; balance: number }[];
  } | null;
  return data?.assets?.find((row) => row.symbol === "USDG")?.balance ?? 0;
}

export function useWalletFunding() {
  const { authenticated, getAccessToken } = usePrivy();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { openModal } = useAuthModal();
  const { ensureTradingWallet } = useEnsureTradingWallet();
  const { addFunds } = useAddFunds();
  const { fundWallet } = useFundWallet();
  const [busy, setBusy] = useState<FundProvider | null>(null);
  const [phase, setPhase] = useState<FundPhase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolveAddress = useCallback(
    async (fallback: string | null) => {
      if (fallback) return fallback;
      const wallet = await ensureTradingWallet();
      return wallet.address;
    },
    [ensureTradingWallet],
  );

  const convert = useCallback(
    async (address: string, usdgBefore: number) => {
      setPhase("wait");
      try {
        await convertOnrampToCash({
          getAccessToken,
          from: address,
          usdgBefore,
          signAuthorization: async (payload) => {
            const { signature } = await generateAuthorizationSignature(payload);
            return signature;
          },
          onPhase: setPhase,
        });
      } finally {
        notifyBalancesChanged();
      }
    },
    [generateAuthorizationSignature, getAccessToken],
  );

  const run = useCallback(
    async (
      walletAddress: string | null,
      provider: FundProvider,
      onramp: (address: string) => Promise<void>,
    ) => {
      if (busy) return;
      if (!authenticated) {
        openModal();
        return;
      }
      setError(null);
      setBusy(provider);
      setPhase("onramp");
      try {
        const address = await resolveAddress(walletAddress);
        const usdgBefore = await usdgBalance(address);
        await onramp(address);
        await convert(address, usdgBefore);
      } catch (err) {
        if (!isFundingDismissed(err)) setError(fundingMessage(err));
      } finally {
        setBusy(null);
        setPhase(null);
      }
    },
    [authenticated, busy, convert, openModal, resolveAddress],
  );

  const openStripe = useCallback(
    (walletAddress: string | null) =>
      run(walletAddress, "stripe", async (address) => {
        await addFunds({
          destination: {
            address,
            chain: FUND_DEST_CHAIN,
            asset: FUND_DEST_USDC,
          },
          fiat: {
            source: {
              assets: ["usd", "eur", "aud", "brl"],
              defaultAsset: "usd",
            },
            environment: "production",
            defaultAmount: FUND_DEFAULT_AMOUNT,
          },
        });
      }),
    [addFunds, run],
  );

  const openCoinbase = useCallback(
    (walletAddress: string | null) =>
      run(walletAddress, "coinbase", async (address) => {
        const result = await fundWallet({
          address,
          options: {
            chain: base,
            amount: FUND_DEFAULT_AMOUNT,
            asset: "USDC",
            defaultFundingMethod: "card",
            card: { preferredProvider: "coinbase" },
          },
        });
        if (result.status === "cancelled") {
          throw new Error("cancelled");
        }
      }),
    [fundWallet, run],
  );

  const openMoonpay = useCallback(
    (walletAddress: string | null) =>
      run(walletAddress, "moonpay", async (address) => {
        const result = await fundWallet({
          address,
          options: {
            chain: base,
            amount: FUND_DEFAULT_AMOUNT,
            asset: "USDC",
            defaultFundingMethod: "card",
            card: { preferredProvider: "moonpay" },
          },
        });
        if (result.status === "cancelled") {
          throw new Error("cancelled");
        }
      }),
    [fundWallet, run],
  );

  return { busy, phase, error, openStripe, openCoinbase, openMoonpay };
}
