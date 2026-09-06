-- Native USDG parimutuel desk (community test).
--
-- Robinhood Chain memes. Odds are the pools. Losing side pays winners.
-- Stakes pull USDG into NATIVE_ESCROW_WALLET. At expiry the tape pays winners.
-- $200 desk cap. Seed 0. Run after 0007_referrals.sql.

create table if not exists public.native_markets (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  kind text not null check (kind in ('strike', 'pvp')),
  title text not null,
  token_a text not null,
  token_b text,
  metric text check (metric in ('marketCap', 'price')),
  strike numeric(24, 8),
  open_at timestamptz not null default now(),
  lock_at timestamptz not null,
  expiry_at timestamptz not null,
  seed_a numeric(20, 6) not null default 0,
  seed_b numeric(20, 6) not null default 0,
  open_mcap_a numeric(24, 8),
  open_mcap_b numeric(24, 8),
  open_price_a numeric(24, 12),
  open_price_b numeric(24, 12),
  resolved_side text check (resolved_side in ('a', 'b', 'void')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint native_markets_window check (lock_at <= expiry_at)
);

create unique index if not exists native_markets_slug_key
  on public.native_markets (slug);

create index if not exists native_markets_expiry_idx
  on public.native_markets (expiry_at desc);

create table if not exists public.native_stakes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  market_id uuid not null references public.native_markets (id) on delete cascade,
  privy_user_id text not null,
  wallet text,
  side text not null check (side in ('a', 'b')),
  amount numeric(20, 6) not null check (amount > 0),
  tx_hash text,
  payout_tx text,
  payout_amount numeric(20, 6)
);

create unique index if not exists native_stakes_one_ticket
  on public.native_stakes (market_id, privy_user_id);

create unique index if not exists native_stakes_tx_hash_key
  on public.native_stakes (tx_hash)
  where tx_hash is not null;

create index if not exists native_stakes_market_idx
  on public.native_stakes (market_id, side);

alter table public.native_markets enable row level security;
alter table public.native_stakes enable row level security;

notify pgrst, 'reload schema';
