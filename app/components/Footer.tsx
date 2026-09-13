import { Link } from "react-router";
import { useT } from "./I18n";
import { LanguageTrigger } from "./LanguagePicker";
import { DOCS_URL, SOCIALS } from "./site-links";

/** UTC so the server and the browser never disagree across a year boundary. */
const YEAR = new Date().getUTCFullYear();

export function Footer() {
  const t = useT();
  return (
    <footer className="mt-4 border-t border-white/5 pb-[calc(6.75rem+env(safe-area-inset-bottom))] lg:pb-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-3 py-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <img
            src="/logo-full.png"
            alt="Hedge"
            width={160}
            height={32}
            loading="lazy"
            decoding="async"
            className="h-7 w-auto"
          />
          <p className="mt-2.5 text-[13px] text-muted">{t("footer.tagline")}</p>
          <p className="mt-1 text-[12px] text-[#5f5f5f]">
            {t("footer.risk", { year: YEAR })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <LanguageTrigger />
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-medium text-muted transition hover:text-white"
          >
            {t("footer.docs")}
          </a>
          <Link
            to="/pool"
            prefetch="intent"
            className="text-[13px] font-medium text-muted transition hover:text-white"
          >
            {t("footer.pool")}
          </Link>
          <Link
            to="/wall"
            prefetch="intent"
            className="text-[13px] font-medium text-muted transition hover:text-white"
          >
            {t("footer.wall")}
          </Link>
          <Link
            to="/roadmap"
            prefetch="intent"
            className="text-[13px] font-medium text-muted transition hover:text-white"
          >
            {t("footer.roadmap")}
          </Link>
          <Link
            to="/app"
            prefetch="intent"
            className="text-[13px] font-medium text-muted transition hover:text-white"
          >
            {t("footer.app")}
          </Link>
          <Link
            to="/terms"
            prefetch="intent"
            className="text-[13px] font-medium text-muted transition hover:text-white"
          >
            {t("footer.terms")}
          </Link>
          <div className="flex items-center gap-2">
            {SOCIALS.map((social) => (
              <a
                key={social.href}
                href={social.href}
                target="_blank"
                rel="noreferrer"
                aria-label={social.label}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-muted transition hover:border-white/25 hover:text-white"
              >
                {social.icon}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
