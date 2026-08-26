import { useCallback, useEffect, useRef } from "react";
import {
  useConnectWallet,
  usePrivy,
  useWallets,
  type ConnectedWallet,
  type User,
} from "@privy-io/react-auth";

export function isEmbeddedWallet(client?: string | null) {
  return client === "privy" || client === "privy-v2";
}

export function primaryWalletAddress(user: User | null | undefined) {
  const wallets = (user?.linkedAccounts ?? []).filter(
    (account) => account.type === "wallet",
  );
  const external = wallets.find(
    (w) => !isEmbeddedWallet(w.walletClientType),
  );
  return external?.address ?? user?.wallet?.address ?? null;
}

export function linkedEmbeddedAddress(user: User | null | undefined) {
  const wallets = (user?.linkedAccounts ?? []).filter(
    (account) => account.type === "wallet",
  );
  const embedded = wallets.find((w) => isEmbeddedWallet(w.walletClientType));
  return embedded && "address" in embedded ? String(embedded.address) : null;
}

export function findWallet(
  wallets: ConnectedWallet[],
  address: string | null | undefined,
) {
  if (!address) return undefined;
  const target = address.toLowerCase();
  return wallets.find((w) => w.address.toLowerCase() === target);
}

export function embeddedWallet(wallets: ConnectedWallet[]) {
  return (
    wallets.find((w) => isEmbeddedWallet(w.walletClientType)) ?? undefined
  );
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
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  const waiter = useRef<{
    address: string;
    resolve: (wallet: ConnectedWallet) => void;
    reject: (err: Error) => void;
    timer: number;
  } | null>(null);

  const finish = useCallback((wallet: ConnectedWallet | undefined) => {
    const pending = waiter.current;
    if (!pending || !wallet) return false;
    if (wallet.address.toLowerCase() !== pending.address.toLowerCase()) return false;
    window.clearTimeout(pending.timer);
    waiter.current = null;
    pending.resolve(wallet);
    return true;
  }, []);

  const { connectWallet } = useConnectWallet({
    onSuccess: () => {
      const pending = waiter.current;
      if (!pending) return;
      finish(findWallet(walletsRef.current, pending.address));
    },
    onError: () => {
      const pending = waiter.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      waiter.current = null;
      pending.reject(new Error("Connect the wallet that holds your USDG."));
    },
  });

  useEffect(() => {
    const pending = waiter.current;
    if (!pending) return;
    finish(findWallet(wallets, pending.address));
  }, [wallets, finish]);

  const cashAddress = authenticated ? primaryWalletAddress(user) : null;
  const cashWallet = findWallet(wallets, cashAddress);

  const ensureCashWallet = useCallback(async () => {
    const address = primaryWalletAddress(user);
    if (!address) {
      throw new Error("Connect the wallet that holds your USDG.");
    }
    const already = findWallet(walletsRef.current, address);
    if (already) return already;
    return new Promise<ConnectedWallet>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!waiter.current) return;
        waiter.current = null;
        reject(new Error("Connect the wallet that holds your USDG."));
      }, 90_000);
      waiter.current = { address, resolve, reject, timer };
      connectWallet({
        suggestedAddress: address,
        description: "Reconnect the wallet that holds your USDG.",
      });
    });
  }, [user, connectWallet]);

  return { privyReady, cashAddress, cashWallet, ensureCashWallet };
}
