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
    supabaseUrl: required("SUPABASE_URL"),
    // sb_secret_..., or the legacy service_role JWT. Either bypasses row level
    // security, so this must never be sent to the browser.
    supabaseServiceRoleKey:
      required("SUPABASE_SECRET_KEY") ?? required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function missingSecrets(keys: (keyof ReturnType<typeof serverSecrets>)[]) {
  const secrets = serverSecrets();
  return keys.filter((key) => !secrets[key]);
}
