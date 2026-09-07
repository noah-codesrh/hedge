import { Link, Outlet } from "react-router";
import { SOCIALS } from "../components/site-links";
import { TopProgress } from "../components/TopProgress";

const YEAR = new Date().getUTCFullYear();

/** Slim chrome for the app waitlist. No search, no trading header. */
export default function WaitlistShell() {
  return (
    <div className="min-h-screen bg-bg">
      <TopProgress />
      <header className="sticky top-0 z-40 border-b border-white/5 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16">
          <Link to="/" prefetch="intent" className="shrink-0">
            <img
              src="/logo-full.png"
              alt="Hedge"
              width={160}
              height={32}
              className="h-7 w-auto"
            />
          </Link>
          <Link
            to="/"
            prefetch="intent"
            className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black transition hover:brightness-105"
          >
            Trade now
          </Link>
        </div>
      </header>
      <Outlet />
      <footer className="border-t border-white/5 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6">
          <p className="text-[12px] text-[#5f5f5f]">
            © {YEAR} Hedge. Prediction markets carry risk of loss.
          </p>
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
      </footer>
    </div>
  );
}
