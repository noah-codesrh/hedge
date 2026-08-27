interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID?: string;
  /**
   * Hedge contracts on Robinhood Chain. Optional on purpose: with these unset
   * the leverage selector shows sizing but refuses to submit, and the Earn
   * page reports the vault as not yet live.
   */
  readonly VITE_HEDGE_ENGINE_ADDRESS?: string;
  readonly VITE_HEDGE_VAULT_ADDRESS?: string;
  /**
   * Master switch for leverage and the vault. Anything but "true" hides the
   * Leverage tab, the Earn page and the leverage selector, leaving spot
   * Polymarket trading as the only path.
   */
  readonly VITE_LEVERAGE_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
