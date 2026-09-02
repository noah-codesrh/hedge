import type { Route } from "./+types/api.leverage.orders";
import { requirePrivyUser, userHasWallet } from "../lib/server/privy-auth";
import {
  cancelUserOrder,
  fillUserOrder,
  insertUserOrder,
  listUserOrders,
} from "../lib/server/leverage-orders";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

function text(value: unknown, max = 200) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : "";
}

function amount(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId } = await requirePrivyUser(request);
  return Response.json({ orders: await listUserOrders(userId) });
}

export async function action({ request }: Route.ActionArgs) {
  const { userId, user } = await requirePrivyUser(request);

  if (request.method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return Response.json({ error: "Missing order." }, { status: 400 });
    const result = await cancelUserOrder(userId, id);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (request.method === "PATCH") {
    const id = text(body.id, 64);
    if (!id || body.status !== "filled") {
      return Response.json({ error: "Invalid update." }, { status: 400 });
    }
    const result = await fillUserOrder(userId, id);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const wallet = text(body.wallet, 42);
  const kind = text(body.kind, 8);
  const marketSlug = text(body.marketSlug, 200);
  const limitPrice = amount(body.limitPrice);
  if (!ADDR.test(wallet)) {
    return Response.json({ error: "Invalid wallet." }, { status: 400 });
  }
  if (!userHasWallet(user, wallet)) {
    return Response.json(
      { error: "That wallet is not linked to this account." },
      { status: 403 },
    );
  }
  if (kind !== "open" && kind !== "close") {
    return Response.json({ error: "Invalid order." }, { status: 400 });
  }
  if (!marketSlug || limitPrice == null) {
    return Response.json({ error: "Invalid order." }, { status: 400 });
  }

  const result = await insertUserOrder({
    userId,
    wallet,
    kind,
    marketSlug,
    isLong: body.isLong === true,
    triggerAbove: body.triggerAbove === true,
    margin: amount(body.margin) ?? 0,
    leverage: amount(body.leverage) ?? 1,
    limitPrice,
    positionId: kind === "close" ? text(body.positionId, 80) || null : null,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true });
}
