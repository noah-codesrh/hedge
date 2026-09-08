import { useEffect, useState } from "react";
import type { NativeMarketView } from "./native";
import type { NativeQuote } from "./native-tokens";

const TAPE_MS = 12_000;

type DeskPayload = {
  markets?: NativeMarketView[];
  quotes?: NativeQuote[];
  deskUsed?: number;
  deskCap?: number;
};

function tapeGet(path: string) {
  return fetch(path, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
}

export function useNativeDesk(initial: DeskPayload) {
  const [live, setLive] = useState<DeskPayload | null>(null);
  const desk = live ?? initial;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await tapeGet("/api/native");
        if (!res.ok) return;
        const data = (await res.json()) as DeskPayload;
        if (!alive || !Array.isArray(data.markets)) return;
        setLive(data);
      } catch {
        /* next tick */
      }
    };
    const id = window.setInterval(() => void tick(), TAPE_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return desk;
}

export function useNativeMarket(slug: string, initial: NativeMarketView) {
  const [live, setLive] = useState<NativeMarketView | null>(null);
  const market = live && live.slug === slug ? live : initial;

  useEffect(() => {
    let alive = true;
    setLive(null);
    if (!slug) return;
    const tick = async () => {
      try {
        const res = await tapeGet(`/api/native/${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { market?: NativeMarketView };
        if (!alive || !data.market) return;
        setLive(data.market);
      } catch {
        /* next tick */
      }
    };
    const id = window.setInterval(() => void tick(), TAPE_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [slug]);

  return market;
}
