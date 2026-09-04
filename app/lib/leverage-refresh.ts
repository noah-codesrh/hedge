async function postRefresh(
  accessToken: string,
  body: Record<string, unknown>,
) {
  const res = await fetch("/api/leverage/refresh", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(payload.error ?? "Could not refresh the on-chain price.");
  }
}

/** Unpause opening without waiting on a full oracle walk. */
export async function ensureOpeningLive(accessToken: string) {
  await postRefresh(accessToken, { openOnly: true });
}

export async function ensureOracleFresh(
  accessToken: string,
  slugs: string[],
  opts: { sweep?: boolean } = {},
) {
  const wanted = slugs.map((s) => s.trim()).filter(Boolean);
  if (wanted.length === 0) return;
  await postRefresh(accessToken, { slugs: wanted, sweep: opts.sweep });
}
