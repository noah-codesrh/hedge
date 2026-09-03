import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Header } from "../components/Header";
import { CheckIcon } from "../components/icons";
import { streamHedgieChat } from "../lib/hedgie-client";
import {
  HEDGIE_AVATAR,
  HEDGIE_NAME,
  HEDGIE_SUGGESTIONS,
  parseTradeIntents,
  ticketHref,
  type ChatMessage,
  type TradeIntent,
} from "../lib/hedgie";
import { originFromMatches, siteMeta } from "../lib/seo";

export function meta({ matches }: { matches: Array<{ id: string; loaderData?: unknown }> }) {
  return siteMeta({
    title: `Hedge — ${HEDGIE_NAME}`,
    description: `${HEDGIE_NAME} is your Hedge copilot. Odds, vault leverage, and a ticket you still have to open.`,
    origin: originFromMatches(matches),
  });
}

export async function loader() {
  const { hedgieConfigured } = await import("../lib/server/hedgie");
  return { configured: hedgieConfigured() };
}

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  intents: TradeIntent[];
  streaming?: boolean;
};

let msgSeq = 0;
const nextId = () => `m${++msgSeq}-${Date.now()}`;

function HedgieAvatar({ size = 132 }: { size?: number }) {
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <span
        className="animate-hedgie-glow absolute rounded-full bg-gold/25 blur-3xl"
        style={{ width: size * 1.35, height: size * 1.35 }}
      />
      <div className="animate-hedgie-float relative">
        <img
          src={HEDGIE_AVATAR}
          alt={HEDGIE_NAME}
          className="animate-hedgie-look rounded-full object-cover shadow-2xl ring-1 ring-white/10"
          style={{ width: size, height: size }}
        />
      </div>
    </div>
  );
}

function FormattedText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi} className="space-y-1.5">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                  <span>{l.replace(/^\s*[-*]\s+/, "")}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap leading-relaxed">
            {block}
          </p>
        );
      })}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="animate-hedgie-typing h-1.5 w-1.5 rounded-full bg-[#8a8a8a]"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function TradeCard({ intent }: { intent: TradeIntent }) {
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-gold/25 bg-[#1c1c1c]">
      <div className="flex items-center justify-between border-b border-white/5 bg-gold/5 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gold">
          Trade ticket
        </span>
        <span className="text-[11px] text-[#8a8a8a]">Review &amp; open</span>
      </div>
      <div className="px-4 py-4">
        <div className="text-sm font-semibold text-white">{intent.market}</div>
        <div className="mt-0.5 text-[13px] text-[#8a8a8a]">
          Backing <span className="text-white">{intent.selection}</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-[#141414] px-2 py-2.5 ring-1 ring-white/5">
            <div className="text-[11px] text-[#8a8a8a]">Margin</div>
            <div className="mt-0.5 text-sm font-semibold text-white">${intent.margin}</div>
          </div>
          <div className="rounded-xl bg-[#141414] px-2 py-2.5 ring-1 ring-white/5">
            <div className="text-[11px] text-[#8a8a8a]">Leverage</div>
            <div className="mt-0.5 text-sm font-semibold text-white">{intent.leverage}x</div>
          </div>
          <div className="rounded-xl bg-[#141414] px-2 py-2.5 ring-1 ring-white/5">
            <div className="text-[11px] text-[#8a8a8a]">Position</div>
            <div className="mt-0.5 text-sm font-semibold text-gold">
              ${intent.margin * intent.leverage}
            </div>
          </div>
        </div>
        <Link
          to={ticketHref(intent)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-semibold text-black transition hover:brightness-105"
        >
          <CheckIcon />
          Review &amp; open
        </Link>
      </div>
    </div>
  );
}

function PanelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HedgieSidebar({
  open,
  onToggle,
  onNewChat,
}: {
  open: boolean;
  onToggle: () => void;
  onNewChat: () => void;
}) {
  return (
    <aside
      className={`hidden shrink-0 flex-col gap-1 border-r border-white/5 p-3 transition-all duration-200 md:flex ${
        open ? "w-60" : "w-[68px] items-center"
      }`}
    >
      <div className={`flex items-center ${open ? "justify-between" : "justify-center"} px-1 py-1`}>
        {open ? <span className="text-sm font-semibold text-white">{HEDGIE_NAME}</span> : null}
        <button
          type="button"
          onClick={onToggle}
          title={open ? "Collapse" : "Expand"}
          className="grid h-9 w-9 place-items-center rounded-xl text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
        >
          <PanelIcon />
        </button>
      </div>
      <button
        type="button"
        onClick={onNewChat}
        title="New chat"
        className={`flex items-center rounded-xl text-[#cfcfcf] transition hover:bg-white/5 hover:text-white ${
          open ? "gap-2.5 px-2.5 py-2 text-sm" : "h-9 w-9 justify-center"
        }`}
      >
        <PlusIcon />
        {open ? <span>New chat</span> : null}
      </button>
    </aside>
  );
}

function HedgieMobileDrawer({
  open,
  onClose,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
}) {
  return (
    <div className={`fixed inset-0 z-[60] md:hidden ${open ? "" : "pointer-events-none"}`}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        className={`absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col gap-1 border-r border-white/10 bg-[#181818] p-3 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-1 py-1">
          <span className="text-sm font-semibold text-white">{HEDGIE_NAME}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="grid h-9 w-9 place-items-center rounded-xl text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onClose();
          }}
          className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
        >
          <PlusIcon />
          <span>New chat</span>
        </button>
      </aside>
    </div>
  );
}

function HedgieChat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setError(null);
      setInput("");

      const userMsg: UiMessage = { id: nextId(), role: "user", text, intents: [] };
      const assistantId = nextId();
      const history = messages;

      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", text: "", intents: [], streaming: true },
      ]);
      setBusy(true);

      const apiMessages: ChatMessage[] = [
        ...history.map((m) => ({ role: m.role, content: m.text })),
        { role: "user", content: text },
      ];

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const full = await streamHedgieChat(apiMessages, {
          signal: controller.signal,
          onToken: (delta) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)),
            ),
        });
        const { cleanText, intents } = parseTradeIntents(full);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: cleanText, intents, streaming: false } : m,
          ),
        );
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages],
  );

  const empty = messages.length === 0;

  return (
    <main className="relative flex min-h-0 flex-1 flex-col">
      {empty ? (
        <div className="relative flex flex-1 flex-col items-center justify-center px-4">
          <div className="pointer-events-none absolute inset-0 hedgie-grid" />
          <div className="relative flex flex-col items-center">
            <HedgieAvatar />
            <h1 className="mt-9 text-center text-4xl font-semibold leading-[1.15] tracking-tight">
              <span className="block text-white">Let's open</span>
              <span className="block text-[#7c7c7c]">a leveraged position</span>
            </h1>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
          <div className="mx-auto w-full max-w-3xl space-y-6 py-8">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gold px-4 py-2.5 text-sm font-medium text-black">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <img
                    src={HEDGIE_AVATAR}
                    alt={HEDGIE_NAME}
                    className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                  />
                  <div className="min-w-0 max-w-[85%] text-sm text-[#e6e6e6]">
                    {m.streaming && !m.text ? <TypingDots /> : <FormattedText text={m.text} />}
                    {m.intents.map((intent, i) => (
                      <TradeCard key={`${intent.marketId}-${i}`} intent={intent} />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      <div className="relative w-full px-4 pb-24 lg:pb-6">
        <div className="mx-auto w-full max-w-3xl">
          {error ? <p className="mb-2 text-center text-xs text-down">{error}</p> : null}
          {empty ? (
            <div className="mb-3 flex flex-wrap justify-center gap-2">
              {HEDGIE_SUGGESTIONS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => void send(hint)}
                  className="rounded-full bg-[#181818] px-3 py-1.5 text-[12px] text-[#8a8a8a] ring-1 ring-white/10 transition hover:text-white hover:ring-white/20"
                >
                  {hint}
                </button>
              ))}
            </div>
          ) : null}
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={() => void send(input)}
            busy={busy}
          />
          <p className="mt-3 text-center text-[11px] text-[#6f6f6f]">
            {HEDGIE_NAME} can make mistakes. Please double-check important actions.
          </p>
        </div>
      </div>
    </main>
  );
}

function ChatInput({
  value,
  onChange,
  onSend,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className="relative rounded-2xl border border-white/10 bg-[#181818] px-4 pb-14 pt-4 transition focus-within:border-white/25">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Suggest the highest winning-chance market and open a position…"
        className="no-scrollbar block max-h-44 w-full resize-none bg-transparent text-[15px] text-white placeholder-[#7a7a7a] outline-none"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={busy || !value.trim()}
        aria-label="Send"
        className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-gold text-black transition hover:brightness-105 disabled:cursor-default disabled:bg-white/10 disabled:text-[#8a8a8a]"
      >
        {busy ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 19V5M12 5l-6 6M12 5l6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

function NotConfigured() {
  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center px-4 text-center">
      <HedgieAvatar size={104} />
      <h1 className="mt-7 text-2xl font-semibold text-white">Meet {HEDGIE_NAME}</h1>
      <p className="mt-2 max-w-sm text-sm text-[#8a8a8a]">
        Hedgie is unavailable right now. Try again in a bit.
      </p>
    </main>
  );
}

export default function AiPage({
  loaderData,
}: {
  loaderData: { configured: boolean };
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const configured = loaderData.configured;
  const newChat = () => setResetKey((k) => k + 1);

  return (
    <div className="flex h-screen flex-col bg-[#141414]">
      <Header />
      <div className="flex min-h-0 flex-1">
        {configured ? (
          <>
            <HedgieSidebar
              open={sidebarOpen}
              onToggle={() => setSidebarOpen((v) => !v)}
              onNewChat={newChat}
            />
            <HedgieMobileDrawer
              open={mobileNavOpen}
              onClose={() => setMobileNavOpen(false)}
              onNewChat={newChat}
            />
          </>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          {configured ? (
            <div className="flex items-center gap-1 border-b border-white/5 px-2 py-2 md:hidden">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
                className="grid h-9 w-9 place-items-center rounded-xl text-[#cfcfcf] transition hover:bg-white/5 hover:text-white"
              >
                <PanelIcon />
              </button>
            </div>
          ) : null}
          {configured ? <HedgieChat key={resetKey} /> : <NotConfigured />}
        </div>
      </div>
    </div>
  );
}
