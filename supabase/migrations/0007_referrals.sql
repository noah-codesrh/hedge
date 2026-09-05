-- Referral names and fee-share ledger.
--
-- A user picks a public code (hedgeapp.trade/?ref=name). First login with
-- that cookie binds the referee forever. Tracked trades credit the referrer
-- a cut of the take. Top referrers are paid manually. Run this after
-- 0006_agent_bets.sql.

create table if not exists public.referral_codes (
  privy_user_id text primary key,
  code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_codes_code_format check (code ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$')
);

create unique index if not exists referral_codes_code_key
  on public.referral_codes (code);

create table if not exists public.referral_code_history (
  code text primary key,
  privy_user_id text not null,
  replaced_at timestamptz not null default now()
);

create index if not exists referral_code_history_user_idx
  on public.referral_code_history (privy_user_id);

create table if not exists public.referrals (
  referee_id text primary key,
  referrer_id text not null,
  code text not null,
  created_at timestamptz not null default now(),
  constraint referrals_no_self check (referee_id <> referrer_id)
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_id, created_at desc);

create table if not exists public.referral_earnings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  referrer_id text not null,
  referee_id text not null,
  trade_id uuid,
  volume numeric(20, 6) not null check (volume >= 0),
  take_bps integer not null,
  share_bps integer not null,
  amount numeric(20, 6) not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'claiming', 'paid')),
  claim_id uuid,
  tx_hash text
);

create unique index if not exists referral_earnings_trade_key
  on public.referral_earnings (trade_id)
  where trade_id is not null;

create index if not exists referral_earnings_referrer_status_idx
  on public.referral_earnings (referrer_id, status, created_at desc);

create table if not exists public.referral_claims (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  privy_user_id text not null,
  wallet text not null,
  amount numeric(20, 6) not null check (amount > 0),
  tx_hash text,
  status text not null default 'sent'
    check (status in ('sent', 'failed'))
);

create index if not exists referral_claims_user_idx
  on public.referral_claims (privy_user_id, created_at desc);

alter table public.referral_codes enable row level security;
alter table public.referral_code_history enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_earnings enable row level security;
alter table public.referral_claims enable row level security;

notify pgrst, 'reload schema';
