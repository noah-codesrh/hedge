-- Venue chat. Hedge-native posts keyed by Polymarket event id.
--
-- Run this after 0002_profiles.sql in the Supabase SQL editor.
--
-- Same access model as trades: the Hedge server writes with the service role
-- key, and RLS is enabled with no policies so anon and authenticated roles are
-- denied. Polymarket comments are fetched live and never stored here.

create table if not exists public.venue_comments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  privy_user_id text not null,
  event_id text not null,
  event_slug text,
  market_id text,
  body text not null
);

create index if not exists venue_comments_event_idx
  on public.venue_comments (event_id, created_at desc);

create index if not exists venue_comments_user_idx
  on public.venue_comments (privy_user_id, created_at desc);

alter table public.venue_comments enable row level security;
