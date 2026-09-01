import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, type User } from "@privy-io/react-auth";
import { shorten } from "../lib/format";
import { readNickname } from "../lib/nickname";
import {
  loadVenueFeed,
  postVenueComment,
  venueAvatarUrl,
  VENUE_BODY_MAX,
  type VenueFeed,
  type VenueMessage,
  type VenueSource,
} from "../lib/venue-chat";
import { primaryWalletAddress } from "../lib/wallet";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { ChatIcon } from "./icons";

function privyPhoto(user: User | null | undefined) {
  const twitter = user?.twitter as { profilePictureUrl?: string } | undefined;
  const google = user?.google as { picture?: string } | undefined;
  const discord = user?.discord as { image?: string } | undefined;
  return twitter?.profilePictureUrl || google?.picture || discord?.image || null;
}

function hedgeLabel(user: User | null | undefined) {
  if (!user?.id) return "Anonymous";
  return readNickname(user.id).trim() || shorten(primaryWalletAddress(user)) || "Anonymous";
}

type Filter = "all" | "hedge";

function ago(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 20_000) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

export function VenueChat({
  eventId,
  eventSlug,
  marketId,
}: {
  eventId: string;
  eventSlug: string;
  marketId?: string | null;
}) {
  const privyReady = usePrivyMounted();
  return (
    <section className="min-w-0 overflow-hidden rounded-3xl bg-card ring-1 ring-white/5">
      <div className="flex items-start gap-3 px-4 pt-5 pb-3 sm:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold">
          <ChatIcon size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">Venue</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">
            Polymarket comments for this event, plus posts that stay on Hedge.
          </p>
        </div>
      </div>
      {privyReady ? (
        <VenueChatInner
          eventId={eventId}
          eventSlug={eventSlug}
          marketId={marketId}
        />
      ) : (
        <VenueChatGuest eventId={eventId} />
      )}
    </section>
  );
}

function VenueChatGuest({ eventId }: { eventId: string }) {
  const { openModal } = useAuthModal();
  const feed = useVenueFeed(eventId);
  return (
    <>
      <FeedBody feed={feed} />
      <div className="border-t border-white/5 px-4 py-4 sm:px-5">
        <p className="text-[13px] text-muted">Sign in to post on Hedge.</p>
        <button
          type="button"
          onClick={openModal}
          className="mt-3 w-full rounded-full bg-gold py-3 text-[15px] font-semibold text-black transition hover:bg-gold/90"
        >
          Sign in
        </button>
      </div>
    </>
  );
}

function VenueChatInner({
  eventId,
  eventSlug,
  marketId,
}: {
  eventId: string;
  eventSlug: string;
  marketId?: string | null;
}) {
  const { authenticated, getAccessToken, user } = usePrivy();
  const { openModal } = useAuthModal();
  const feed = useVenueFeed(eventId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body || busy) return;
    if (!authenticated) {
      openModal();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Session expired. Sign in again.");
      const wallet = primaryWalletAddress(user);
      const photo = privyPhoto(user);
      const { message } = await postVenueComment(token, {
        eventId,
        eventSlug,
        marketId,
        wallet,
        photo,
        nickname: user?.id ? readNickname(user.id).trim() || null : null,
        body,
      });
      feed.append({
        ...message,
        author: hedgeLabel(user) || message.author,
        avatarUrl:
          message.avatarUrl || venueAvatarUrl(wallet || user?.id || "hedge", photo),
      });
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }, [
    authenticated,
    busy,
    draft,
    eventId,
    eventSlug,
    feed.append,
    user,
    getAccessToken,
    marketId,
    openModal,
  ]);

  return (
    <>
      <FeedBody feed={feed} />
      <form
        className="border-t border-white/5 px-4 py-4 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {authenticated ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, VENUE_BODY_MAX))}
              rows={2}
              maxLength={VENUE_BODY_MAX}
              placeholder="Say something about this market"
              className="w-full resize-none rounded-2xl bg-[#1b1b1b] px-3.5 py-3 text-[14px] outline-none ring-1 ring-white/10 placeholder:text-muted focus:ring-white/20"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted">
                {feed.data && !feed.data.hedgeLive
                  ? "Hedge posts need the database connected."
                  : `${draft.length}/${VENUE_BODY_MAX}`}
              </p>
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-white/90 disabled:opacity-40"
              >
                {busy ? "Posting…" : "Post"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-muted">Sign in to post on Hedge.</p>
            <button
              type="button"
              onClick={openModal}
              className="mt-3 w-full rounded-full bg-gold py-3 text-[15px] font-semibold text-black transition hover:bg-gold/90"
            >
              Sign in
            </button>
          </>
        )}
        {error ? <p className="mt-2 text-[13px] text-down">{error}</p> : null}
      </form>
    </>
  );
}

function useVenueFeed(eventId: string) {
  const [data, setData] = useState<VenueFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const next = await loadVenueFeed(eventId);
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load venue chat.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    setLoading(true);
    void reload();
    const id = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(id);
  }, [eventId, reload]);

  const append = useCallback((message: VenueMessage) => {
    setData((cur) => {
      if (!cur) return { eventId, messages: [message], hedgeLive: true };
      if (cur.messages.some((row) => row.id === message.id)) return cur;
      return { ...cur, messages: [...cur.messages, message] };
    });
  }, [eventId]);

  return { data, error, loading, reload, append };
}

function FeedBody({
  feed,
}: {
  feed: ReturnType<typeof useVenueFeed>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => {
    const rows = feed.data?.messages ?? [];
    if (filter === "hedge") return rows.filter((row) => row.source === "hedge");
    return rows;
  }, [feed.data?.messages, filter]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.id]);

  return (
    <div className="border-t border-white/5">
      <div className="flex gap-1 px-4 pt-3 sm:px-5">
        <FilterChip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All"
        />
        <FilterChip
          active={filter === "hedge"}
          onClick={() => setFilter("hedge")}
          label="Hedge"
        />
      </div>
      <div
        ref={listRef}
        className="max-h-[28rem] divide-y divide-white/5 overflow-y-auto px-4 py-2 sm:px-5"
      >
        {feed.loading && !feed.data ? (
          <p className="py-8 text-center text-[13px] text-muted">Loading…</p>
        ) : feed.error && !feed.data ? (
          <p className="py-8 text-center text-[13px] text-down">{feed.error}</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">
            {filter === "hedge"
              ? "No Hedge posts on this event yet."
              : "No comments on this event yet."}
          </p>
        ) : (
          messages.map((row) => <MessageRow key={row.id} message={row} />)
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
        active
          ? "bg-white text-black"
          : "bg-white/5 text-muted hover:bg-white/10 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function MessageRow({ message }: { message: VenueMessage }) {
  const src = message.avatarUrl || venueAvatarUrl(message.author);
  return (
    <article className="flex gap-3 py-3">
      <img
        src={src}
        alt=""
        width={36}
        height={36}
        className="mt-0.5 h-9 w-9 shrink-0 rounded-full bg-[#1b1b1b] object-cover ring-1 ring-white/10"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="truncate text-[13px] font-semibold">{message.author}</p>
          <SourcePill source={message.source} />
          <p className="text-[11px] text-muted">{ago(message.createdAt)}</p>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-snug text-white/90">
          {message.body}
        </p>
      </div>
    </article>
  );
}

function SourcePill({ source }: { source: VenueSource }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        source === "hedge"
          ? "bg-gold/15 text-gold"
          : "bg-white/8 text-muted"
      }`}
    >
      {source === "hedge" ? "Hedge" : "Polymarket"}
    </span>
  );
}
