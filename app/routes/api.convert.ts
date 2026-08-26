import type { Route } from "./+types/api.convert";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  return Response.json(
    { error: "Mock conversion is disabled. Buys now settle through Relay." },
    { status: 410 },
  );
}
