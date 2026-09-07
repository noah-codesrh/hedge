-- Emails for the Hedge mobile app waitlist.
-- Public page posts through the Hedge server. Service role writes. RLS on,
-- no policies, so anon cannot read the list.

create table if not exists public.app_waitlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint app_waitlist_email_format check (
    email ~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$'
  )
);

alter table public.app_waitlist enable row level security;

notify pgrst, 'reload schema';
