import type { Route } from "./+types/api.assets";
import { listRobinhoodAssets } from "../lib/robinhood";

export async function loader({ request }: Route.LoaderArgs) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return { assets: [], error: "Missing wallet address" };
  }
  try {
    const assets = await listRobinhoodAssets(address);
    return { assets, error: null as string | null };
  } catch (e) {
    return {
      assets: [],
      error: e instanceof Error ? e.message : "Failed to load assets",
    };
  }
}
