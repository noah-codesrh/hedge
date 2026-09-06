-- Automatic USDG pool: stake hashes and winner payouts.
-- Safe to run if 0008 already landed without these columns.

alter table public.native_markets
  drop constraint if exists native_markets_resolved_side_check;

alter table public.native_markets
  add constraint native_markets_resolved_side_check
  check (resolved_side in ('a', 'b', 'void') or resolved_side is null);

alter table public.native_stakes
  add column if not exists tx_hash text;

alter table public.native_stakes
  add column if not exists payout_tx text;

alter table public.native_stakes
  add column if not exists payout_amount numeric(20, 6);

create unique index if not exists native_stakes_tx_hash_key
  on public.native_stakes (tx_hash)
  where tx_hash is not null;

notify pgrst, 'reload schema';
