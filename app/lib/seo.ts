export const SITE_TITLE = "Hedge";
/** Canonical public URL. Shared artwork must not point at a preview host. */
export const SITE_URL = "https://hedgeapp.trade/";
export const SITE_DESCRIPTION = "Trade predictions. Up to 3x-10x leverage";
export const OG_IMAGE_PATH = "/og-preview.jpg";

export function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const proto = (
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")
  )
    .split(",")[0]
    .trim();
  const host = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    url.host
  )
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

export function originFromMatches(
  matches: Array<{ id: string; loaderData?: unknown } | undefined>,
) {
  const data = matches.find((m) => m?.id === "root")?.loaderData as
    | { origin?: string }
    | undefined;
  return data?.origin;
}

export function siteMeta(options?: { title?: string; origin?: string }) {
  const title = options?.title ?? SITE_TITLE;
  const origin = (options?.origin ?? "").replace(/\/$/, "");
  const image = `${origin}${OG_IMAGE_PATH}`;
  return [
    { title },
    { name: "description", content: SITE_DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_TITLE },
    { property: "og:title", content: title },
    { property: "og:description", content: SITE_DESCRIPTION },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1024" },
    { property: "og:image:height", content: "537" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: SITE_DESCRIPTION },
    { name: "twitter:image", content: image },
  ];
}
