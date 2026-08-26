import type { Route } from "./+types/api.pm.status";

const STATUS_URL = "https://status.polymarket.com/v2/components.json";

const DOWN = new Set([
  "MAJOROUTAGE",
  "PARTIALOUTAGE",
  "UNDERMAINTENANCE",
  "DEGRADEDPERFORMANCE",
]);

export async function loader(_args: Route.LoaderArgs) {
  try {
    const res = await fetch(STATUS_URL, {
      headers: { Accept: "application/json" },
    });
    const data: unknown = await res.json().catch(() => null);
    const components =
      data &&
      typeof data === "object" &&
      "components" in data &&
      Array.isArray((data as { components: unknown }).components)
        ? ((data as { components: Array<{ name?: string; status?: string }> })
            .components)
        : [];
    const clob = components.find((item) =>
      /trading api\s*\(clob\)|^clob$/i.test(String(item.name ?? "").trim()),
    );
    const status = String(clob?.status ?? "UNKNOWN").toUpperCase();
    const ok = !DOWN.has(status);
    return Response.json({ ok, status, service: clob?.name?.trim() ?? "CLOB" });
  } catch {
    return Response.json({ ok: true, status: "UNKNOWN", service: "CLOB" });
  }
}
