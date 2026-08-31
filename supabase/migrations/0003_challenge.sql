-- Premier League challenge. Marks EPL spot trades so the leaderboard
-- can sum volume and realized PnL without scanning every row.
--
-- Run this after 0002_profiles.sql in the Supabase SQL editor.

alter table public.trades
  add column if not exists league text;

create index if not exists trades_league_created_idx
  on public.trades (league, created_at desc)
  where league is not null;

create index if not exists trades_user_league_idx
  on public.trades (privy_user_id, league, created_at desc);
