-- User profiles and nickname history.
--
-- Run this after 0001_trades.sql in the Supabase SQL editor.
--
-- Same access model as trades: the Hedge server writes with the service role
-- key, and RLS is enabled with no policies so anon and authenticated roles are
-- denied. Join to public.trades on privy_user_id.

create table if not exists public.profiles (
  privy_user_id text primary key,
  -- The nickname the user explicitly set. Null means they never set one and
  -- the app is falling back to a social handle or shortened address.
  nickname text,
  wallet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_wallet_idx
  on public.profiles (lower(wallet));

-- Append-only history. One row per actual change, so counting rows per user
-- gives how often they rename themselves.
create table if not exists public.nickname_changes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  privy_user_id text not null
    references public.profiles (privy_user_id) on delete cascade,
  wallet text,
  previous_nickname text,
  nickname text not null
);

create index if not exists nickname_changes_user_idx
  on public.nickname_changes (privy_user_id, created_at desc);

create index if not exists nickname_changes_created_at_idx
  on public.nickname_changes (created_at desc);

alter table public.profiles enable row level security;
alter table public.nickname_changes enable row level security;
