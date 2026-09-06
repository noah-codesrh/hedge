import type { Route } from "./+types/api.native.settle";
import { settleExpired, settleNative } from "../lib/server/native-markets";

function authorized(request: Request) {
  const key = process.env.NATIVE_SETTLE_KEY?.trim();
  if (!key) return true;
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  return token === key;
}

/** Oracle-settles expired cards and pays winners from the escrow wallet. */
export async function loader({ request }: Route.LoaderArgs) {
  if (!authorized(request) && process.env.NATIVE_SETTLE_KEY?.trim()) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await settleExpired();
  return Response.json(result);
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const slug = String(body.slug ?? "").trim();
  if (!slug) {
    const result = await settleExpired();
    return Response.json(result);
  }
  const result = await settleNative(slug, body.side);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result);
}
