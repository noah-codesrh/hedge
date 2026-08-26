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
  };
}

export function missingSecrets(keys: (keyof ReturnType<typeof serverSecrets>)[]) {
  const secrets = serverSecrets();
  return keys.filter((key) => !secrets[key]);
}
