import { hedgieConfigured, streamHedgie } from "../lib/server/hedgie";
import type { ChatMessage } from "../lib/hedgie";

export async function loader() {
  return Response.json({ configured: hedgieConfigured() });
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!hedgieConfigured()) {
    return Response.json(
      { error: "Hedgie is unavailable right now." },
      { status: 503 },
    );
  }

  let messages: ChatMessage[] = [];
  try {
    const body = (await request.json()) as { messages?: unknown };
    messages = Array.isArray(body.messages)
      ? body.messages
          .filter(
            (m): m is ChatMessage =>
              !!m &&
              typeof m === "object" &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string",
          )
          .slice(-16)
      : [];
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (messages.length === 0) {
    return Response.json({ error: "Say something first." }, { status: 400 });
  }

  try {
    const stream = await streamHedgie(messages, request.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return Response.json(
      { error: "Hedgie is unavailable right now. Try again in a moment." },
      { status: 502 },
    );
  }
}
