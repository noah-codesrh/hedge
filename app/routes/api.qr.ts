import { SITE_URL } from "../lib/seo";
import { parseReferralCode } from "../lib/referral";

const QR_ENDPOINT = "https://api.qrserver.com/v1/create-qr-code/";

/**
 * Same-origin QR for share cards. The canvas taints on a cross-origin image,
 * and the upstream service sends no CORS headers. Only the site origin, or a
 * validated referral URL on that origin, can be encoded.
 */
export async function loader({ request }: { request: Request }) {
  const origin = SITE_URL.replace(/\/$/, "");
  const code = parseReferralCode(new URL(request.url).searchParams.get("ref"));
  const data = code ? `${origin}/?ref=${encodeURIComponent(code)}` : `${origin}/`;

  const upstream = await fetch(
    `${QR_ENDPOINT}?size=350x350&bgcolor=141414&color=ffffff&qzone=1&format=png&data=${encodeURIComponent(data)}`,
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
