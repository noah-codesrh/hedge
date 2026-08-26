const KEY = "hedge:pm:deposit:";

export function loadDepositWallet(signer: string | null | undefined) {
  if (typeof window === "undefined" || !signer) return null;
  try {
    const value = window.localStorage.getItem(KEY + signer.toLowerCase());
    if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
    // The Privy signer is never the funder. Ignore a stale EOA cache.
    if (value.toLowerCase() === signer.toLowerCase()) return null;
    return value;
  } catch {
    return null;
  }
}

export function saveDepositWallet(signer: string, deposit: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY + signer.toLowerCase(), deposit);
}

export function knownPortfolioAddresses(
  signers: Array<string | null | undefined>,
) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const signer of signers) {
    if (!signer || !/^0x[a-fA-F0-9]{40}$/.test(signer)) continue;
    const key = signer.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(signer);
    }
    const deposit = loadDepositWallet(signer);
    if (deposit) {
      const d = deposit.toLowerCase();
      if (!seen.has(d)) {
        seen.add(d);
        out.push(deposit);
      }
    }
  }
  return out.slice(0, 6);
}
