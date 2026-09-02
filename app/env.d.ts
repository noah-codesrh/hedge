interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID?: string;
  /**
   * Hedge contracts on Robinhood Chain. Optional on purpose: with these unset
   * the leverage selector shows sizing but refuses to submit, and the Earn
   * page reports the vault as not yet live.
   */
  readonly VITE_HEDGE_ENGINE_ADDRESS?: string;
  readonly VITE_HEDGE_VAULT_ADDRESS?: string;
  readonly VITE_HEDGE_STOCK_COLLATERAL?: string;
  /**
   * Master switch for leveraged trading. Anything but "true" hides the
   * leverage selector. Earn is independent: a set vault address is enough
   * to take senior deposits.
   */
  readonly VITE_LEVERAGE_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
