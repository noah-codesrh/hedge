import { SITE_URL } from "../lib/seo";

const QR_ENDPOINT = "https://api.qrserver.com/v1/create-qr-code/";

/**
 * Same-origin QR for the share card. Sharing a position renders the card to a
 * canvas, which a cross-origin image would taint, and the upstream service
 * sends no CORS headers. The encoded target is fixed so this cannot be used as
 * an open proxy.
 */
export async function loader() {
  const upstream = await fetch(
    `${QR_ENDPOINT}?size=350x350&bgcolor=141414&color=ffffff&qzone=1&format=png&data=${encodeURIComponent(SITE_URL)}`,
  ).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return new Response("QR unavailable.", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
