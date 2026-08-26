import type { Route } from "./+types/api.pm.balance";
import { POLYGON_RPC, PUSD } from "../lib/chains";
import { requirePrivySession } from "../lib/server/privy-auth";
import { missingSecrets } from "../lib/server/secrets";

function encodeBalanceOf(owner: string) {
  return `0x70a08231${owner.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  if (missingSecrets(["privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Trading is not configured." }, { status: 503 });
  }
  await requirePrivySession(request);
  const wallet = new URL(request.url).searchParams.get("wallet")?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return Response.json({ error: "Missing deposit wallet." }, { status: 400 });
  }

  const res = await fetch(POLYGON_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: PUSD, data: encodeBalanceOf(wallet) }, "latest"],
    }),
  });
  const data: unknown = await res.json().catch(() => null);
  const hex =
    data && typeof data === "object" && "result" in data
      ? String((data as { result: unknown }).result ?? "0x0")
      : "0x0";
  let raw = 0n;
  try {
    raw = BigInt(hex || "0x0");
  } catch {
    raw = 0n;
  }
  const pusd = Number(raw) / 1e6;
  return Response.json({
    wallet,
    raw: raw.toString(),
    pusd: Number.isFinite(pusd) ? pusd : 0,
  });
}
