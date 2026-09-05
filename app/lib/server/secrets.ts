function required(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function serverSecrets() {
  return {
    privyAppId: required("PRIVY_APP_ID") ?? required("VITE_PRIVY_APP_ID"),
    privyAppSecret: required("PRIVY_APP_SECRET"),
    relayApiKey: required("RELAY_BRIDGE_API_KEY"),
    builderApiKey: required("BUILDER_CODE_API_KEY"),
    builderSecret: required("BUILDER_CODE_SECRET_KEY"),
    builderPassphrase: required("BUILDER_CODE_PASSPHRASE"),
    builderCode: required("POLYMARKET_BUILDER_CODE"),
    relayerApiKeyId: required("RELAYER_API_KEY"),
    relayerApiKeyAddress: required("RELAYER_API_KEY_ADDRESS"),
    // Hedge contracts on Robinhood Chain. Read from the VITE_ names too so a
    // single .env drives the browser and the sponsorship allowlist together —
    // if these ever disagree, sponsored calls would be refused for the exact
    // contracts the app is pointing at.
    hedgeEngineAddress:
      required("HEDGE_ENGINE_ADDRESS") ?? required("VITE_HEDGE_ENGINE_ADDRESS"),
    hedgeVaultAddress:
      required("HEDGE_VAULT_ADDRESS") ?? required("VITE_HEDGE_VAULT_ADDRESS"),
    hedgeStockCollateral:
      required("HEDGE_STOCK_COLLATERAL") ??
      required("VITE_HEDGE_STOCK_COLLATERAL"),
    // Reporter key for on-demand oracle pushes. Same key the Railway keeper
    // used. Never prefix with VITE_.
    oracleReporterKey:
      required("ORACLE_REPORTER_KEY") ?? required("RELAYER_PRIVATE_KEY"),
    oracleAddress:
      required("ORACLE_ADDRESS") ?? required("VITE_HEDGE_ORACLE_ADDRESS"),
    supabaseUrl: required("SUPABASE_URL"),
    // sb_secret_..., or the legacy service_role JWT. Either bypasses row level
    // security, so this must never be sent to the browser.
    supabaseServiceRoleKey:
      required("SUPABASE_SECRET_KEY") ?? required("SUPABASE_SERVICE_ROLE_KEY"),
    // Server-only. Never prefix with VITE_ — the example app leaked this in
    // the browser bundle. Hedgie streams through /api/hedgie instead.
    openrouterKey: required("OPENROUTER_API_KEY"),
    openrouterModel:
      required("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini",
    agentApiKey: required("AGENT_API_KEY"),
    agentApiKeys: required("AGENT_API_KEYS"),
    agentMaxMargin: required("AGENT_MAX_MARGIN"),
    agentMaxLeverage: required("AGENT_MAX_LEVERAGE"),
    agentDailyNotional: required("AGENT_DAILY_NOTIONAL"),
  };
}

export function missingSecrets(keys: (keyof ReturnType<typeof serverSecrets>)[]) {
  const secrets = serverSecrets();
  return keys.filter((key) => !secrets[key]);
}
