-- Trade volume tracking.
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Writes come from the Hedge server using the service role key, which bypasses
-- row level security. RLS is enabled with no policies so that the anon and
-- authenticated roles cannot read or write this table even if the publishable
-- key leaks into a browser.

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Who traded. privy_user_id is the stable identity; wallet is the Robinhood
  -- Chain address the USDG moved through, proxy_wallet the Polymarket funder.
  privy_user_id text not null,
  wallet text not null,
  proxy_wallet text,

  direction text not null check (direction in ('buy', 'sell')),
  -- Direction on the outcome token, and the market's own name for it
  -- ("Yes"/"No" on a binary market, otherwise a team or candidate).
  outcome text not null check (outcome in ('yes', 'no')),
  outcome_label text,

  event_slug text,
  market_slug text,
  token_id text,
  title text,

  -- Volume. usdg is what the user put in on a buy and took out on a sell.
  usdg numeric(20, 6) not null check (usdg >= 0),
  pusd numeric(20, 6) check (pusd >= 0),
  shares numeric(30, 6) check (shares >= 0),
  price numeric(12, 6) check (price >= 0 and price <= 1),

  -- CLOB order id, used to make a retried report idempotent.
  order_id text,
  conversion_id text
);

-- A client that retries a report must not double count volume.
create unique index if not exists trades_order_id_key
  on public.trades (order_id)
  where order_id is not null;

create index if not exists trades_created_at_idx
  on public.trades (created_at desc);

create index if not exists trades_wallet_idx
  on public.trades (lower(wallet));

create index if not exists trades_token_id_idx
  on public.trades (token_id);

alter table public.trades enable row level security;

-- Daily volume, split by direction. security_invoker keeps the view under the
-- caller's permissions rather than the view owner's.
create or replace view public.trade_volume_daily
  with (security_invoker = true) as
select
  date_trunc('day', created_at) as day,
  direction,
  count(*) as trades,
  count(distinct lower(wallet)) as wallets,
  sum(usdg) as usdg
from public.trades
group by 1, 2
order by 1 desc, 2;
