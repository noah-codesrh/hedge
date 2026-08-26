const env = import.meta.env;

export const ENV = {
  privyAppId: (env.VITE_PRIVY_APP_ID as string | undefined) ?? "",
} as const;

export const isBrowser = typeof window !== "undefined";

/** Privy is browser-only; never mount it during SSR. */
export const PRIVY_ENABLED = isBrowser && ENV.privyAppId.length > 0;
