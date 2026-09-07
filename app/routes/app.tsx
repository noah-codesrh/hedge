import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CheckIcon } from "../components/icons";
import { ArtDeposit, ArtLeverage, ArtYesNo } from "../components/WaitlistArt";
import { originFromMatches, siteMeta } from "../lib/seo";
import { parseWaitlistEmail } from "../lib/waitlist";
import type { Route } from "./+types/app";

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({
    title: "App waitlist · Hedge",
    description:
      "The Hedge app is coming to your home screen. Leave your email. We will write when iOS and Android are ready.",
    origin: originFromMatches(matches),
    url: "/app",
  });
}

export function links() {
  return [
    {
      rel: "preload",
      href: "/assets/app/home-screen.png",
      as: "image",
    },
  ];
}

const COMING = [
  {
    title: "Yes / No in USDG",
    body: "Same desk as the web. Cash stays on Robinhood Chain.",
    art: <ArtYesNo />,
  },
  {
    title: "1x, then 2x to 4x",
    body: "Spot fills the venue book. Listed markets can use the vault.",
    art: <ArtLeverage />,
  },
  {
    title: "Deposit from any listed chain",
    body: "Onramp or bridge in. You trade in USDG either way.",
    art: <ArtDeposit />,
  },
];

export default function AppWaitlist() {
  return (
    <main className="relative overflow-x-clip bg-bg">
      <div className="relative z-10 mx-auto grid min-w-0 max-w-6xl items-center gap-10 px-4 pt-14 pb-16 sm:gap-12 sm:pt-16 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-8 lg:pt-20 lg:pb-20">
        <section className="w-full min-w-0">
          <div className="flex flex-col items-start text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
              App waitlist
            </p>
            <h1 className="mt-3 text-[2rem] font-bold leading-[1.1] tracking-tight sm:text-4xl">
              Hedge on your home screen
            </h1>
          </div>
        </section>

        <section className="relative -mx-4 min-w-0 sm:-mx-8 lg:col-start-2 lg:row-span-2 lg:mx-0 lg:-mr-16 lg:self-center">
          <img
            src="/assets/app/home-screen.png"
            alt="Hedge app icon on a phone home screen"
            width={1024}
            height={917}
            className="relative z-10 mx-auto w-[min(160%,48rem)] origin-center scale-125 [mask-image:radial-gradient(ellipse_52%_62%_at_50%_42%,#000_38%,transparent_72%)] drop-shadow-[0_30px_80px_rgba(0,0,0,0.65)] sm:w-[min(140%,56rem)] sm:scale-150 lg:w-[56rem] lg:max-w-none lg:scale-125"
          />
        </section>

        <section className="flex w-full min-w-0 flex-col gap-10 sm:gap-12">
          <WaitlistForm />

          <ul className="space-y-5">
            {COMING.map((item) => (
              <li
                key={item.title}
                className="flex items-center gap-4 rounded-[22px] bg-white/[0.04] p-3 pr-4 text-left ring-1 ring-white/10 sm:gap-5 sm:p-4"
              >
                {item.art}
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-white">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-[12px] leading-relaxed text-[#5f5f5f]">
            No store listing yet. This list is how we reach you when there is.
            Until then,{" "}
            <Link to="/" className="font-medium text-gold hover:underline">
              trade on the web
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}

function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [already, setAlready] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseWaitlistEmail(email);
    if (!parsed) {
      setError("Enter a valid email.");
      return;
    }
    const trap = String(new FormData(e.currentTarget).get("website") ?? "");
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed, website: trap }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        already?: boolean;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "Could not join the waitlist.");
        setStatus("idle");
        return;
      }
      setAlready(Boolean(data?.already));
      setStatus("done");
    } catch {
      setError("Could not reach Hedge. Try again.");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div
        role="status"
        className="rounded-[28px] bg-white/[0.05] px-5 py-6 ring-1 ring-gold/25 backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold text-black">
            <CheckIcon size={16} />
          </span>
          <div>
            <p className="text-[16px] font-semibold text-white">
              {already ? "You are already on the list" : "You are on the list"}
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              We will write when the app is ready. Until then the desk is open
              on the web.
            </p>
            <Link
              to="/"
              className="mt-4 inline-flex rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-105"
            >
              Trade now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="relative rounded-[28px] bg-white/[0.05] p-4 ring-1 ring-white/10 backdrop-blur-xl sm:p-5"
    >
      <label htmlFor="waitlist-email" className="sr-only">
        Email
      </label>
      <input
        id="waitlist-email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (error) setError(null);
        }}
        placeholder="you@email.com"
        className="w-full rounded-full border border-white/10 bg-[#141414]/80 px-5 py-3.5 text-[15px] text-white outline-none placeholder:text-muted focus:border-gold/60 focus:ring-2 focus:ring-gold/20"
      />
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
        <label htmlFor="waitlist-company">Company</label>
        <input
          id="waitlist-company"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <button
        type="submit"
        disabled={status === "saving"}
        className="mt-4 w-full rounded-full bg-gold py-3.5 text-[15px] font-semibold text-black transition hover:brightness-105 disabled:opacity-60"
      >
        {status === "saving" ? "Joining..." : "Join waitlist"}
      </button>
      {error ? (
        <p className="mt-4 text-center text-[13px] text-down" role="alert">
          {error}
        </p>
      ) : (
        <p className="mt-4 text-center text-[12px] text-[#5f5f5f]">
          One email. No spam. We only write when the app is ready.
        </p>
      )}
    </form>
  );
}
