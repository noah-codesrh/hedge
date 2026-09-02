export async function ensureOracleFresh(accessToken: string, slugs: string[]) {
  const wanted = slugs.map((s) => s.trim()).filter(Boolean);
  if (wanted.length === 0) return;

  const res = await fetch("/api/leverage/refresh", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slugs: wanted }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? "Could not refresh the on-chain price.");
  }
}
