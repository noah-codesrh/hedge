import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signedPct } from "../lib/format";
import { outcomeLabel, type LivePosition } from "../lib/polymarket-portfolio";
import { liveHref, PnlShareCard } from "./PnlShareCard";

export type PnlShareData = {
  title: string;
  href: string;
  outcome: string;
  entryPrice: number;
  markPrice: number | null;
  pnl: number | null;
  pctChange: number | null;
  status: "open" | "closed";
  /** Borrowed multiple. Spot tickets leave this off. */
  leverage?: number | null;
};

export function shareFromLive(position: LivePosition): PnlShareData {
  return {
    title: position.title,
    href: liveHref(position),
    outcome: outcomeLabel(position),
    entryPrice: position.entryPrice,
    markPrice:
      (position.status === "closed"
        ? position.exitPrice
        : position.currentPrice) || null,
    pnl: position.pnl,
    pctChange: position.pctChange,
    status: position.status,
  };
}

const FILE_NAME = "hedge-pnl.png";

/**
 * Design width of the card, matched by the preview so the image on screen is
 * exactly the file you get. Captured at 4x for a 1600px square.
 */
const EXPORT_WIDTH = 400;
const EXPORT_SCALE = 4;

async function renderCard(node: HTMLElement) {
  const { toBlob } = await import("html-to-image");
  const options = {
    pixelRatio: EXPORT_SCALE,
    width: EXPORT_WIDTH,
    height: EXPORT_WIDTH,
    backgroundColor: "#141414",
  };
  // The first pass can land before webfonts and images are inlined.
  await toBlob(node, options);
  const blob = await toBlob(node, options);
  if (!blob) throw new Error("Could not render the card.");
  return blob;
}

function saveBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyBlob(blob: Blob) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function isAbort(err: unknown) {
  return err instanceof Error && err.name === "AbortError";
}

type Action = "copy" | "download" | "post";

export function PnlShareModal({
  share,
  onClose,
}: {
  share: PnlShareData;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Render once on open so the preview is a real image the browser can copy,
  // and so the buttons act on an already-rendered file.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const node = cardRef.current;
        if (!node) return;
        const blob = await renderCard(node);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPng({ blob, url });
      } catch {
        /* the live card stays on screen and the buttons re-render on demand */
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const blobFor = useCallback(async () => {
    if (png) return png.blob;
    const node = cardRef.current;
    if (!node) throw new Error("Could not render the card.");
    return renderCard(node);
  }, [png]);

  const run = useCallback(
    async (action: Action, fn: (blob: Blob) => Promise<string | null>) => {
      setBusy(action);
      setError(null);
      setNote(null);
      try {
        setNote(await fn(await blobFor()));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not prepare the image.",
        );
      } finally {
        setBusy(null);
      }
    },
    [blobFor],
  );

  const copy = () =>
    run("copy", async (blob) => {
      if (await copyBlob(blob)) return "Image copied to your clipboard.";
      throw new Error(
        "Your browser blocked the clipboard. Use Download instead.",
      );
    });

  const download = () =>
    run("download", async (blob) => {
      saveBlob(blob);
      return "Saved to your downloads.";
    });

  const post = () =>
    run("post", async (blob) => {
      const text = `${signedPct(share.pctChange ?? 0, 2)} on ${share.title}`;
      const url = `${window.location.origin}${share.href}`;
      const file = new File([blob], FILE_NAME, { type: "image/png" });

      // Mobile share sheets accept the image itself; the X web intent cannot,
      // so fall back to handing the user the file plus a prefilled composer.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text, url });
          return null;
        } catch (err) {
          if (isAbort(err)) return null;
        }
      }

      const copied = await copyBlob(blob);
      if (!copied) saveBlob(blob);
      window.open(
        `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        "_blank",
        "noopener,noreferrer",
      );
      return copied
        ? "Card copied — paste it into your post."
        : "Card downloaded — attach it to your post.";
    });

  const card = (
    <PnlShareCard
      title={share.title}
      href={share.href}
      outcome={share.outcome}
      entryPrice={share.entryPrice}
      markPrice={share.markPrice}
      pnl={share.pnl}
      pctChange={share.pctChange}
      status={share.status}
      leverage={share.leverage}
      asLink={false}
      rounded={false}
    />
  );

  const node = (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[440px] rounded-t-[28px] bg-[#1a1a1a] px-5 pb-7 pt-5 shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/10 animate-pop-in sm:rounded-[28px]">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight">
            Share your P&L
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-full p-1.5 text-muted transition hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Once rendered the preview is the PNG itself, so right-click offers
            "Copy image" and long-press works on mobile. */}
        <div className="mt-4 aspect-square w-full">
          {png ? (
            <img
              src={png.url}
              alt={`${share.title} — ${signedPct(share.pctChange ?? 0, 2)}`}
              className="h-full w-full"
            />
          ) : (
            card
          )}
        </div>

        {/*
          Only the outer wrapper is moved off-screen. html-to-image clones the
          captured node along with its computed styles, so capturing a
          positioned element would place the card outside the render surface.
        */}
        <div
          aria-hidden
          className="pointer-events-none fixed left-[-10000px] top-0"
        >
          <div ref={cardRef} style={{ width: EXPORT_WIDTH }}>
            {card}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={copy}
            disabled={busy !== null}
            className="rounded-full bg-white/5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-50"
          >
            {busy === "copy" ? "Copying…" : "Copy image"}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={busy !== null}
            className="rounded-full bg-white/5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-50"
          >
            {busy === "download" ? "Saving…" : "Download"}
          </button>
        </div>
        <button
          type="button"
          onClick={post}
          disabled={busy !== null}
          className="mt-2 w-full rounded-full bg-gold py-3 text-sm font-semibold text-black transition hover:bg-gold-soft disabled:opacity-50"
        >
          {busy === "post" ? "Preparing…" : "Post on X"}
        </button>

        {error ? (
          <p className="mt-3 text-center text-[13px] text-down">{error}</p>
        ) : note ? (
          <p className="mt-3 text-center text-[13px] text-muted">{note}</p>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
