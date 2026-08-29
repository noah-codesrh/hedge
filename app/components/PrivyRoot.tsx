import { PrivyProvider } from "@privy-io/react-auth";
import { polygon, robinhoodChain } from "../lib/chains";
import { ENV } from "../lib/env";

export default function PrivyRoot({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={ENV.privyAppId}
      config={{
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain, polygon],
        appearance: {
          theme: "dark",
          accentColor: "#F1D65A",
          logo: "/logo-mark.svg",
          // Solana deposits need a Solana refund wallet. Login still only
          // creates the Ethereum cash wallet (see embeddedWallets below).
          walletChainType: "ethereum-and-solana",
          showWalletLoginFirst: false,
          walletList: [
            "detected_ethereum_wallets",
            "metamask",
            "coinbase_wallet",
            "rainbow",
            "robinhood_wallet",
            "wallet_connect",
            "okx_wallet",
            "zerion",
            "bybit_wallet",
          ],
        },
        loginMethods: ["email", "google", "twitter", "discord", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          solana: { createOnLogin: "off" },
          showWalletUIs: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
