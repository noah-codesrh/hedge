import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRevalidator } from "react-router";
import {
  DEFAULT_LOCALE,
  interpolate,
  persistLocale,
  resolveLocale,
  setNumberLocale,
  type Locale,
} from "../lib/i18n";
import { CATALOG, type MessageKey } from "../locales/messages";

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Translate;
  pickerOpen: boolean;
  openLanguagePicker: () => void;
  closeLanguagePicker: () => void;
};

const I18nContext = createContext<I18nValue | null>(null);

function lookup(locale: Locale, key: MessageKey) {
  return CATALOG[locale][key] ?? CATALOG.en[key] ?? key;
}

function LocaleReloader({ locale }: { locale: Locale }) {
  const revalidator = useRevalidator();
  const seen = useRef(locale);
  useEffect(() => {
    if (seen.current === locale) return;
    seen.current = locale;
    void revalidator.revalidate();
  }, [locale, revalidator]);
  return null;
}

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [pickerOpen, setPickerOpen] = useState(false);

  useLayoutEffect(() => {
    const next = resolveLocale();
    setLocaleState(next);
    setNumberLocale(next);
    document.documentElement.lang = next;
    persistLocale(next);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    setNumberLocale(next);
    document.documentElement.lang = next;
    persistLocale(next);
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => interpolate(lookup(locale, key), vars),
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t,
      pickerOpen,
      openLanguagePicker: () => setPickerOpen(true),
      closeLanguagePicker: () => setPickerOpen(false),
    }),
    [locale, pickerOpen, setLocale, t],
  );

  return (
    <I18nContext.Provider value={value}>
      <LocaleReloader locale={locale} />
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return ctx;
}

export function useT() {
  return useI18n().t;
}

/** Yes/No follow the UI language. Named sides (teams, people) stay as listed. */
export function translateSide(
  label: string | undefined,
  t: ReturnType<typeof useT>,
) {
  const raw = (label ?? "").trim();
  if (/^yes$/i.test(raw)) return t("side.yes");
  if (/^no$/i.test(raw)) return t("side.no");
  return raw;
}
