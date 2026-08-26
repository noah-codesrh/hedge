const prefix = "hedge:pm:creds:";

export type StoredApiCreds = {
  key: string;
  secret: string;
  passphrase: string;
};

export function loadTradingCreds(address: string): StoredApiCreds | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(prefix + address.toLowerCase());
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredApiCreds> & {
      apiKey?: string;
    };
    const key = parsed.key ?? parsed.apiKey;
    if (!key || !parsed.secret || !parsed.passphrase) return undefined;
    return {
      key,
      secret: parsed.secret,
      passphrase: parsed.passphrase,
    };
  } catch {
    return undefined;
  }
}

export function saveTradingCreds(address: string, creds: StoredApiCreds) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    prefix + address.toLowerCase(),
    JSON.stringify({
      key: String(creds.key),
      secret: creds.secret,
      passphrase: creds.passphrase,
    }),
  );
}

export function clearTradingCreds(address: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(prefix + address.toLowerCase());
}

export function tradingCredsPreview(address: string) {
  const creds = loadTradingCreds(address);
  if (!creds) return { ready: false, key: null as string | null };
  const key = String(creds.key);
  return {
    ready: true,
    key: key.length > 10 ? `${key.slice(0, 8)}…` : key,
  };
}
