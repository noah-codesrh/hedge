import { useCallback, useEffect, useRef } from "react";
import {
  useCreateWallet,
  usePrivy,
  useWallets,
  type ConnectedWallet,
  type User,
} from "@privy-io/react-auth";
import { ROBINHOOD_ADD_CHAIN, RH_CHAIN_ID } from "./chains";
import { ensureChain, type Eip1193 } from "./evm";

export function isEmbeddedWallet(client?: string | null) {
  return client === "privy" || client === "privy-v2";
}

export function isEvmAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function linkedWallets(user: User | null | undefined) {
  return (user?.linkedAccounts ?? []).filter(
    (account) => account.type === "wallet",
  );
}

export function externalWalletAddress(
  user: User | null | undefined,
  wallets?: ConnectedWallet[],
) {
  const fromUser = linkedWallets(user).find(
    (w) => !isEmbeddedWallet(w.walletClientType),
  );
  if (fromUser && "address" in fromUser) return String(fromUser.address);
  return (
    wallets?.find((w) => !isEmbeddedWallet(w.walletClientType))?.address ?? null
  );
}

export function primaryWalletAddress(
  user: User | null | undefined,
  wallets?: ConnectedWallet[],
) {
  return (
    externalWalletAddress(user, wallets) ??
    linkedEmbeddedAddress(user) ??
    embeddedWallet(wallets)?.address ??
    user?.wallet?.address ??
    null
  );
}

export function linkedEmbeddedAddress(user: User | null | undefined) {
  const embedded = linkedWallets(user).filter(
    (w) => isEmbeddedWallet(w.walletClientType) && "address" in w,
  );
  const evm = embedded.find((w) => isEvmAddress(String(w.address)));
  const pick = evm ?? embedded[0];
  return pick && "address" in pick ? String(pick.address) : null;
}

export function findWallet(
  wallets: ConnectedWallet[] | undefined,
  address: string | null | undefined,
) {
  if (!address || !wallets) return undefined;
  const target = address.toLowerCase();
  return wallets.find((w) => w.address.toLowerCase() === target);
}

export function embeddedWallet(wallets: ConnectedWallet[] | undefined) {
  const embedded = wallets?.filter((w) => isEmbeddedWallet(w.walletClientType));
  return (
    embedded?.find((w) => isEvmAddress(w.address)) ?? embedded?.[0]
  );
}

async function providerChainId(provider: Eip1193) {
  try {
    const raw = await provider.request({ method: "eth_chainId" });
    return BigInt(raw as string);
  } catch {
    return null;
  }
}

/**
 * Put a wallet on Robinhood Chain and return a provider bound to it.
 *
 * The provider has to be re-read after the switch, because one fetched
 * beforehand stays bound to the old chain. The chain id is then confirmed
 * against the provider rather than the wallet's own property: a switch that
 * quietly does nothing would otherwise send on whichever chain the wallet was
 * left on by the trading flow, where the user holds no gas.
 *
 * Silent for Privy embedded; external wallets still get a switch/add prompt.
 */
export async function robinhoodProvider(wallet: ConnectedWallet) {
  let provider = (await wallet.getEthereumProvider()) as Eip1193;
  if ((await providerChainId(provider)) !== BigInt(RH_CHAIN_ID)) {
    try {
      await wallet.switchChain(RH_CHAIN_ID);
    } catch {
      if (!isEmbeddedWallet(wallet.walletClientType)) {
        await ensureChain(provider, ROBINHOOD_ADD_CHAIN);
      }
    }
    provider = (await wallet.getEthereumProvider()) as Eip1193;
  }

  if ((await providerChainId(provider)) !== BigInt(RH_CHAIN_ID)) {
    throw new Error(
      "This wallet could not switch to Robinhood Chain. Switch networks in your wallet, then try again.",
    );
  }
  return provider;
}

/** Email / X / Google / Discord users get a silent Privy embedded wallet. */
let createEmbeddedInFlight: Promise<unknown> | null = null;

export function useEnsureTradingWallet(options?: { provision?: boolean }) {
  const provision = options?.provision !== false;
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const pending = useRef<((wallet: ConnectedWallet) => void) | null>(null);

  useEffect(() => {
    const found = embeddedWallet(wallets);
    if (found) pending.current?.(found);
  }, [wallets]);

  useEffect(() => {
    if (!provision || !authenticated || !privyReady || !walletsReady) return;
    if (embeddedWallet(wallets) || linkedEmbeddedAddress(user)) return;
    if (createEmbeddedInFlight) return;
    createEmbeddedInFlight = createWallet()
      .catch(() => undefined)
      .finally(() => {
        createEmbeddedInFlight = null;
      });
  }, [
    provision,
    authenticated,
    privyReady,
    walletsReady,
    wallets,
    user,
    createWallet,
  ]);

  const tradingWallet = embeddedWallet(wallets);
  const tradingAddress =
    tradingWallet?.address ?? linkedEmbeddedAddress(user) ?? null;

  const ensureTradingWallet = useCallback(async () => {
    const existing = embeddedWallet(wallets);
    if (existing) return existing;
    const waited = new Promise<ConnectedWallet>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.current = null;
        reject(new Error("Could not create a trading wallet."));
      }, 20_000);
      pending.current = (wallet) => {
        window.clearTimeout(timer);
        pending.current = null;
        resolve(wallet);
      };
    });
    if (!linkedEmbeddedAddress(user)) {
      if (!createEmbeddedInFlight) {
        createEmbeddedInFlight = createWallet()
          .catch(() => undefined)
          .finally(() => {
            createEmbeddedInFlight = null;
          });
      }
      await createEmbeddedInFlight;
    }
    const found = embeddedWallet(wallets);
    if (found) {
      pending.current?.(found);
      return found;
    }
    return waited;
  }, [wallets, user, createWallet]);

  return { tradingWallet, tradingAddress, ensureTradingWallet };
}

export function isOnChain(wallet: ConnectedWallet, chainId: number) {
  const raw = String(wallet.chainId ?? "");
  if (!raw) return false;
  if (raw === String(chainId)) return true;
  if (raw.endsWith(`:${chainId}`)) return true;
  try {
    return BigInt(raw) === BigInt(chainId);
  } catch {
    return false;
  }
}

/** Linked cash address survives refresh; the injected/WC connector often does not. */
export function useEnsureCashWallet() {
  const { ready: privyReady, authenticated, user, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const walletsRef = useRef<ConnectedWallet[]>(wallets ?? []);
  walletsRef.current = wallets ?? [];

  const waiter = useRef<{
    address: string;
    resolve: (wallet: ConnectedWallet) => void;
    reject: (err: Error) => void;
    timer: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      const pending = waiter.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      waiter.current = null;
    };
  }, []);

  useEffect(() => {
    const pending = waiter.current;
    if (!pending) return;
    const found = findWallet(wallets, pending.address);
    if (!found) return;
    window.clearTimeout(pending.timer);
    waiter.current = null;
    pending.resolve(found);
  }, [wallets]);

  const cashAddress = authenticated
    ? primaryWalletAddress(user, wallets)
    : null;
  const cashWallet = findWallet(wallets, cashAddress);

  const waitForAddress = (address: string) =>
    new Promise<ConnectedWallet>((resolve, reject) => {
      const already = findWallet(walletsRef.current, address);
      if (already) {
        resolve(already);
        return;
      }
      const timer = window.setTimeout(() => {
        if (!waiter.current) return;
        waiter.current = null;
        reject(new Error("Your wallet is still connecting. Try again in a moment."));
      }, 90_000);
      waiter.current = { address, resolve, reject, timer };
    });

  const ensureCashWallet = useCallback(async () => {
    const live = walletsRef.current;
    const address =
      primaryWalletAddress(user, live) ?? embeddedWallet(live)?.address ?? null;
    if (!address) {
      throw new Error("Your wallet is still being created. Try again in a moment.");
    }
    const already = findWallet(live, address);
    if (already) {
      return already;
    }

    const embeddedAddr = (
      linkedEmbeddedAddress(user) ?? embeddedWallet(live)?.address ?? ""
    ).toLowerCase();
    const embeddedOnly =
      !externalWalletAddress(user, live) ||
      address.toLowerCase() === embeddedAddr;

    if (embeddedOnly) {
      const found = await waitForAddress(address);
      return found;
    }

    const connected = await new Promise<ConnectedWallet>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!waiter.current) return;
        waiter.current = null;
        reject(new Error("Reconnect the wallet that holds your USDG."));
      }, 90_000);
      waiter.current = { address, resolve, reject, timer };
      connectWallet({
        suggestedAddress: address,
        description: "Reconnect the wallet that holds your USDG.",
      });
    });
    return connected;
  }, [user, connectWallet]);

  return { privyReady, cashAddress, cashWallet, ensureCashWallet };
}
