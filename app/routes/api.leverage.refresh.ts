import { requirePrivySession } from "../lib/server/privy-auth";
import {
  liftGuardianPause,
  refreshErrorMessage,
  refreshOracleFor,
  reporterConfigured,
} from "../lib/server/oracle-refresh";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!reporterConfigured()) {
    return Response.json(
      { error: "Price push is not configured on the server." },
      { status: 503 },
    );
  }
  await requirePrivySession(request);

  let slugs: string[] = [];
  let openOnly = false;
  let sweep: boolean | undefined;
  try {
    const body = (await request.json()) as {
      slugs?: unknown;
      openOnly?: unknown;
      sweep?: unknown;
    };
    slugs = Array.isArray(body.slugs)
      ? body.slugs.filter((s): s is string => typeof s === "string").slice(0, 10)
      : [];
    openOnly = body.openOnly === true;
    if (body.sweep === false) sweep = false;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (openOnly) {
      return Response.json(await liftGuardianPause());
    }
    if (slugs.length === 0) {
      return Response.json({ error: "Missing market." }, { status: 400 });
    }
    return Response.json(await refreshOracleFor(slugs, { sweep }));
  } catch (err) {
    console.error("[leverage-refresh]", err);
    return Response.json({ error: refreshErrorMessage(err) }, { status: 502 });
  }
}
