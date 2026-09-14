import { useLayoutEffect, useState } from "react";
import { Link } from "react-router";
import { NATIVE_POOL_OPEN } from "../lib/native";
import { useT } from "./I18n";

const KEY = "hedge.pool-banner";

export function PoolBanner() {
  const t = useT();
  const [shown, setShown] = useState(true);

  useLayoutEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === "0") setShown(false);
    } catch {
      /* private mode */
    }
  }, []);

  if (!shown) return null;

  return (
    <div className="relative overflow-hidden px-5 py-[5px]">
      <div className="pointer-events-none absolute inset-0 bg-gold/[0.05]" />
      <div className="pointer-events-none absolute inset-0 honeycomb-pattern opacity-80" />
      <img
        src="/icons/chrome/pool-honeycomb.png"
        alt=""
        width={1024}
        height={23}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-overlay"
      />
      <img
        src="/icons/chrome/pool-edge.png"
        alt=""
        width={60}
        height={32}
        className="pointer-events-none absolute left-0 top-0 h-8 w-[60px] object-cover"
      />
      <img
        src="/icons/chrome/pool-edge.png"
        alt=""
        width={60}
        height={32}
        className="pointer-events-none absolute right-0 top-0 h-8 w-[60px] -scale-y-100 rotate-180 object-cover"
      />
      <div className="relative mx-auto flex w-full max-w-[1256px] items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[13px] leading-5">
            <span className="font-bold text-gold">
              {NATIVE_POOL_OPEN ? t("banner.poolOpen") : t("banner.poolPaused")}
            </span>
            <span className="font-semibold text-white">
              {" "}
              {NATIVE_POOL_OPEN ? t("banner.poolBody") : t("banner.poolPausedBody")}
            </span>
          </p>
          <Link
            to="/pool"
            prefetch="intent"
            className="shrink-0 rounded-full bg-gold px-2.5 py-0.5 text-[13px] font-semibold leading-[18px] text-black transition hover:brightness-105"
          >
            {t("banner.viewPool")}
          </Link>
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem(KEY, "0");
            } catch {
              /* private mode */
            }
            setShown(false);
          }}
          aria-label={t("banner.dismiss")}
          className="grid size-[14px] shrink-0 place-items-center"
        >
          <img
            src="/icons/chrome/close.svg"
            alt=""
            width={14}
            height={14}
            className="block max-w-none"
          />
        </button>
      </div>
    </div>
  );
}
