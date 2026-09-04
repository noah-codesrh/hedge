-- Resting leverage limits. Filled by the signed-in client against the
-- existing engine (openPosition / reducePosition). No new contract.

create table if not exists public.leverage_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  privy_user_id text not null,
  wallet text not null,
  kind text not null check (kind in ('open', 'close')),
  market_slug text not null,
  is_long boolean not null,
  trigger_above boolean not null default false,
  margin numeric(20, 6) not null default 0,
  leverage numeric(8, 4) not null default 1,
  limit_price numeric(12, 6) not null check (limit_price > 0 and limit_price < 1),
  position_id text,
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled'))
);

create index if not exists leverage_orders_user_idx
  on public.leverage_orders (privy_user_id, status, created_at desc);

alter table public.leverage_orders enable row level security;

notify pgrst, 'reload schema';
