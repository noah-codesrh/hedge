import { useCallback, useEffect, useRef } from "react";
import {
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
  wallets: ConnectedWallet[] | undefined,
  address: string | null | undefined,
) {
  if (!address || !wallets) return undefined;
  const target = address.toLowerCase();
  return wallets.find((w) => w.address.toLowerCase() === target);
}

export function embeddedWallet(wallets: ConnectedWallet[] | undefined) {
  return wallets?.find((w) => isEmbeddedWallet(w.walletClientType));
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
