/** Same 1.5% take as a vault ticket. Referrers earn a cut of that, not of volume. */
export const REFERRAL_TAKE_BPS = 150;
/** 20% of the take. 30 bps of referred USDG volume. */
export const REFERRAL_SHARE_BPS = 2_000;
export const REFERRAL_MIN_CLAIM = 1;
export const REFERRAL_COOKIE = "hedge_ref";
export const REFERRAL_STORAGE = "hedge:ref";

const RESERVED = new Set([
  "admin",
  "ai",
  "api",
  "claim",
  "earn",
  "hedge",
  "hedgie",
  "login",
  "market",
  "profile",
  "ref",
  "referral",
  "rewards",
  "roademap",
  "roadmap",
  "token",
  "wall",
]);

export function parseReferralCode(raw: string | null | undefined) {
  const code = (raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/.test(code)) return null;
  if (RESERVED.has(code)) return null;
  return code;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** First invite code. Six random letters, still editable later. */
export function randomReferralCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => LETTERS[byte % 26]!).join("");
}

export function referralPath(code: string) {
  return `/?ref=${encodeURIComponent(code)}`;
}

export function referralShareOfVolume(volume: number) {
  if (!(volume > 0)) return 0;
  return (volume * REFERRAL_TAKE_BPS * REFERRAL_SHARE_BPS) / 100_000_000;
}

export function readStoredRef() {
  if (typeof document === "undefined") return null;
  const fromCookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${REFERRAL_COOKIE}=`))
    ?.slice(REFERRAL_COOKIE.length + 1);
  const cookie = parseReferralCode(fromCookie ? decodeURIComponent(fromCookie) : null);
  if (cookie) return cookie;
  try {
    return parseReferralCode(window.localStorage.getItem(REFERRAL_STORAGE));
  } catch {
    return null;
  }
}

/** First touch only. A later link does not steal an existing cookie. */
export function captureReferralCode(raw: string | null | undefined) {
  const code = parseReferralCode(raw);
  if (!code || typeof document === "undefined") return;
  if (readStoredRef()) return;
  const maxAge = 60 * 60 * 24 * 30;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
  try {
    window.localStorage.setItem(REFERRAL_STORAGE, code);
  } catch {
    /* private mode */
  }
}
