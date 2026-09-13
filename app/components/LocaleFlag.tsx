import { localeMeta, type Locale } from "../lib/i18n";

export function LocaleFlag({
  locale,
  size = 32,
  className = "",
}: {
  locale: Locale;
  size?: number;
  className?: string;
}) {
  const iso = localeMeta(locale).flag;
  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-full bg-[#2a2a2a] ring-1 ring-white/15 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <img
        src={`/flags/${iso}.svg`}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
