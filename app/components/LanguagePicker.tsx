import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LOCALES, localeMeta } from "../lib/i18n";
import { CheckIcon } from "./icons";
import { useI18n } from "./I18n";
import { LocaleFlag } from "./LocaleFlag";

export function LanguageTrigger({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { t, locale, openLanguagePicker } = useI18n();
  const current = localeMeta(locale);

  if (compact) {
    return (
      <button
        type="button"
        onClick={openLanguagePicker}
        aria-label={t("language.open")}
        title={current.native}
        className={`grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] transition hover:bg-white/10 ${className}`}
      >
        <LocaleFlag locale={locale} size={22} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openLanguagePicker}
      className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] font-medium text-muted transition hover:border-white/25 hover:text-white ${className}`}
    >
      <LocaleFlag locale={locale} size={16} />
      <span>{current.native}</span>
    </button>
  );
}

export function LanguageRow({
  onPick,
  className = "",
  style,
}: {
  onPick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t, locale, openLanguagePicker } = useI18n();
  const current = localeMeta(locale);

  return (
    <button
      type="button"
      style={style}
      onClick={() => {
        onPick?.();
        openLanguagePicker();
      }}
      className={className}
    >
      <span>{t("menu.language")}</span>
      <span className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <LocaleFlag locale={locale} size={18} />
        {current.native}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}

export function LanguageSettings() {
  const { t, locale, openLanguagePicker } = useI18n();
  const current = localeMeta(locale);

  return (
    <button
      type="button"
      onClick={openLanguagePicker}
      className="flex w-full items-center gap-3 rounded-3xl bg-card px-4 py-3.5 text-left ring-1 ring-white/5 transition hover:bg-white/[0.03]"
    >
      <LocaleFlag locale={locale} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-white">
          {t("language.title")}
        </span>
        <span className="block text-[13px] text-muted">{current.native}</span>
      </span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted"
        aria-hidden
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}

export function LanguagePickerHost() {
  const { pickerOpen, closeLanguagePicker } = useI18n();
  return (
    <LanguagePicker open={pickerOpen} onClose={closeLanguagePicker} />
  );
}

function LanguagePicker({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, locale, setLocale } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const { style } = document.body;
    const overflowY = style.overflowY;
    style.overflowY = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      style.overflowY = overflowY;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[70] ${open ? "" : "pointer-events-none invisible"}`}
    >
      <div
        onClick={onClose}
        aria-hidden
        className={`absolute inset-0 bg-black/70 backdrop-blur-[3px] transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("language.title")}
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-[#171717] shadow-[0_0_60px_rgba(0,0,0,0.6)] outline-none transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] sm:border-l sm:border-white/10 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-4 pb-3 pt-[calc(0.875rem+env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("language.close")}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-muted transition hover:text-white"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M15 6 9 12l6 6" />
            </svg>
          </button>
          <h2 className="text-[17px] font-semibold text-white">
            {t("language.title")}
          </h2>
        </div>

        <ul className="no-scrollbar flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {LOCALES.map((item) => {
            const selected = item.code === locale;
            return (
              <li key={item.code}>
                <button
                  type="button"
                  onClick={() => {
                    setLocale(item.code);
                    onClose();
                  }}
                  aria-current={selected ? "true" : undefined}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                    selected
                      ? "bg-white/[0.08] text-white"
                      : "text-[#e6e6e6] hover:bg-white/[0.05]"
                  }`}
                >
                  <LocaleFlag locale={item.code} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-tight">
                      {item.native}
                    </span>
                    {item.native !== item.english ? (
                      <span className="mt-0.5 block text-[12px] text-muted">
                        {item.english}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <span className="text-gold">
                      <CheckIcon size={18} />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
