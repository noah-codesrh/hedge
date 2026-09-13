/** UI language. Polymarket titles follow this via Gamma `locale`. */

export const LOCALES = [
  { code: "en", bcp47: "en-US", native: "English", english: "English", flag: "us" },
  { code: "es", bcp47: "es", native: "Español", english: "Spanish", flag: "es" },
  { code: "pt", bcp47: "pt-BR", native: "Português", english: "Portuguese", flag: "br" },
  { code: "fr", bcp47: "fr", native: "Français", english: "French", flag: "fr" },
  { code: "de", bcp47: "de", native: "Deutsch", english: "German", flag: "de" },
  { code: "zh", bcp47: "zh-CN", native: "中文", english: "Chinese", flag: "cn" },
  { code: "ja", bcp47: "ja", native: "日本語", english: "Japanese", flag: "jp" },
  { code: "ko", bcp47: "ko", native: "한국어", english: "Korean", flag: "kr" },
  { code: "hi", bcp47: "hi", native: "हिन्दी", english: "Hindi", flag: "in" },
  { code: "id", bcp47: "id", native: "Bahasa Indonesia", english: "Indonesian", flag: "id" },
  { code: "it", bcp47: "it", native: "Italiano", english: "Italian", flag: "it" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

const STORAGE_KEY = "hedge.locale";
const COOKIE = "hedge_locale";

const CODES = new Set<string>(LOCALES.map((l) => l.code));

export function isLocale(value: string | null | undefined): value is Locale {
  return Boolean(value && CODES.has(value));
}

export function localeMeta(code: Locale) {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

/** Formatter tag. Updated when the trader picks a language. */
let activeBcp47: string = LOCALES[0].bcp47;

export function numberLocale() {
  return activeBcp47;
}

export function setNumberLocale(code: Locale) {
  activeBcp47 = localeMeta(code).bcp47;
}

export function persistLocale(code: Locale) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Private mode can refuse storage. Cookie still covers the next visit.
  }
  document.cookie = `${COOKIE}=${code}; path=/; max-age=31536000; SameSite=Lax`;
}

export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Fall through to the cookie.
  }
  const match = document.cookie.match(/(?:^|;\s*)hedge_locale=([^;]+)/);
  const fromCookie = match?.[1];
  return isLocale(fromCookie) ? fromCookie : null;
}

export function detectBrowserLocale(): Locale | null {
  if (typeof navigator === "undefined") return null;
  const tags = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const raw of tags) {
    if (!raw) continue;
    const tag = raw.toLowerCase();
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}

export function resolveLocale(): Locale {
  return readStoredLocale() ?? detectBrowserLocale() ?? DEFAULT_LOCALE;
}

export function localeFromRequest(request: Request): Locale {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)hedge_locale=([^;]+)/);
  const value = match?.[1]?.trim();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Gamma's `locale` query. English is the default (omit the param).
 * `pt-BR` and `zh-CN` 422; use `pt` and `zh`.
 */
export function gammaLocale(locale?: string | null) {
  if (!locale || locale === DEFAULT_LOCALE) return undefined;
  return isLocale(locale) ? locale : undefined;
}

export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}
