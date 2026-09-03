-- Agent Wall fills.
--
-- Outside agents open and close vault tickets through /api/agent/bets.
-- Writes use the service role. RLS on, no policies: anon cannot read this.

create table if not exists public.agent_bets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent text not null,
  kind text not null check (kind in ('open', 'close')),
  market_slug text not null default '',
  title text,
  side text not null check (side in ('yes', 'no')),
  margin numeric(20, 6) not null default 0,
  leverage numeric(8, 4) not null default 1,
  position_id text,
  tx_hash text,
  idempotency_key text,
  status text not null default 'filled'
);

create unique index if not exists agent_bets_idempotency_key
  on public.agent_bets (agent, idempotency_key)
  where idempotency_key is not null;

create index if not exists agent_bets_created_at_idx
  on public.agent_bets (created_at desc);

create index if not exists agent_bets_agent_idx
  on public.agent_bets (agent, created_at desc);

create index if not exists agent_bets_position_idx
  on public.agent_bets (agent, position_id)
  where position_id is not null;

alter table public.agent_bets enable row level security;
