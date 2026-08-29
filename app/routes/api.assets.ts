import type { Route } from "./+types/api.assets";
import { listRobinhoodAssets } from "../lib/robinhood";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

function addressesFrom(request: Request) {
  const url = new URL(request.url);
  const many = url.searchParams.get("addresses") ?? "";
  const one = url.searchParams.get("address")?.trim() ?? "";
  const all = [...many.split(","), one]
    .map((a) => a.trim())
    .filter((a) => ADDR.test(a));
  return [...new Set(all.map((a) => a.toLowerCase()))].slice(0, 6);
}

function mergeAssets(rows: Awaited<ReturnType<typeof listRobinhoodAssets>>[]) {
  const byId = new Map<string, (typeof rows)[0][number]>();
  for (const list of rows) {
    for (const asset of list) {
      const prev = byId.get(asset.id);
      if (!prev) {
        byId.set(asset.id, { ...asset });
        continue;
      }
      prev.balance += asset.balance;
      prev.valueUsd = (prev.valueUsd ?? 0) + (asset.valueUsd ?? 0);
    }
  }
  return [...byId.values()];
}

export async function loader({ request }: Route.LoaderArgs) {
  const addresses = addressesFrom(request);
  if (addresses.length === 0) {
    return { assets: [], error: "Missing wallet address" };
  }
  try {
    const rows = await Promise.all(addresses.map((a) => listRobinhoodAssets(a)));
    return { assets: mergeAssets(rows), error: null as string | null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load assets";
    return {
      assets: [],
      error: /html|<!DOCTYPE|Unexpected token/i.test(message)
        ? "Could not read Robinhood Chain. Try again in a moment."
        : message,
    };
  }
}
