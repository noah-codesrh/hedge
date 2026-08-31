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

export const REWARDS_OG_IMAGE_PATH = "/premiere-league-rewards.png";
export const REWARDS_TITLE = "Premier League Rewards · Hedge";
export const REWARDS_DESCRIPTION =
  "$1,000 Premier League pool. $500 top volume, $500 highest realized PnL. Spot EPL only.";

export function siteMeta(options?: {
  title?: string;
  origin?: string;
  description?: string;
  image?: string;
  imageWidth?: string;
  imageHeight?: string;
  url?: string;
}) {
  const title = options?.title ?? SITE_TITLE;
  const description = options?.description ?? SITE_DESCRIPTION;
  const origin = (options?.origin ?? "").replace(/\/$/, "");
  const image = `${origin}${options?.image ?? OG_IMAGE_PATH}`;
  const pageUrl = options?.url ? `${origin}${options.url}` : undefined;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_TITLE },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    ...(pageUrl ? [{ property: "og:url", content: pageUrl }] : []),
    { property: "og:image", content: image },
    { property: "og:image:width", content: options?.imageWidth ?? "1024" },
    { property: "og:image:height", content: options?.imageHeight ?? "537" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}

export function rewardsMeta(origin?: string) {
  return siteMeta({
    title: REWARDS_TITLE,
    description: REWARDS_DESCRIPTION,
    origin,
    image: REWARDS_OG_IMAGE_PATH,
    imageWidth: "2090",
    imageHeight: "1175",
    url: "/rewards",
  });
}
