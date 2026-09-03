import type { ChatMessage } from "./hedgie";

/**
 * Stream Hedgie from our server.
 */
export async function streamHedgieChat(
  messages: ChatMessage[],
  opts: { onToken?: (delta: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const res = await fetch("/api/hedgie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail || `Hedgie request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const delta = json?.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          opts.onToken?.(delta);
        }
      } catch {
        /* partial JSON across chunks */
      }
    }
  }

  return full;
}
