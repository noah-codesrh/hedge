import type { Route } from "./+types/api.native";
import { listNativeMarkets } from "../lib/server/native-markets";

export async function loader() {
  const { tracked, markets, quotes, deskUsed, deskCap, escrowWallet, payoutLive } =
    await listNativeMarkets();
  return Response.json(
    {
      tracked,
      markets,
      quotes,
      deskUsed,
      deskCap,
      escrowWallet,
      payoutLive,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
