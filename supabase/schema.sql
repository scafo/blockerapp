-- Acquisti in Lume (Nico, 20 novembre 2026). Da incollare una volta in Supabase → SQL Editor → Run.
-- Il saldo del Lume e le consegne stanno solo qui: il gioco li legge tramite api/ e non può scriverli.
-- Le funzioni che muovono il Lume girano solo col service role (dalle funzioni Vercel), mai dal browser.

create table if not exists public.wallets (
  user_id uuid primary key references auth.users on delete cascade,
  lume integer not null default 0 check (lume >= 0),
  updated_at timestamptz not null default now()
);

-- Un pagamento Stripe = una riga: la chiave è la sessione di Checkout, così un webhook ripetuto non accredita due volte.
create table if not exists public.purchases (
  session_id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  pack text not null,
  lume integer not null,
  amount_cents integer not null,
  currency text not null,
  created_at timestamptz not null default now()
);

-- Cosa il server ha consegnato dopo una spesa in Lume; il gioco lo applica al profilo e poi lo segna come ritirato.
create table if not exists public.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item text not null,
  cost integer not null,
  payload jsonb not null,
  claimed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists grants_open on public.grants (user_id) where not claimed;

-- Oggetti estetici posseduti (uno per tipo).
create table if not exists public.owned (
  user_id uuid not null references auth.users on delete cascade,
  item text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item)
);

-- Ognuno vede solo le sue righe; nessuna regola di scrittura = dal browser non si scrive niente.
alter table public.wallets enable row level security;
alter table public.purchases enable row level security;
alter table public.grants enable row level security;
alter table public.owned enable row level security;
drop policy if exists "own wallet" on public.wallets;
create policy "own wallet" on public.wallets for select using (auth.uid() = user_id);
drop policy if exists "own purchases" on public.purchases;
create policy "own purchases" on public.purchases for select using (auth.uid() = user_id);
drop policy if exists "own grants" on public.grants;
create policy "own grants" on public.grants for select using (auth.uid() = user_id);
drop policy if exists "own items" on public.owned;
create policy "own items" on public.owned for select using (auth.uid() = user_id);

-- Accredito dopo un pagamento confermato da Stripe. Ritorna false se la sessione era già stata accreditata.
create or replace function public.credit_lume(p_session text, p_user uuid, p_pack text, p_lume integer, p_amount integer, p_currency text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into purchases (session_id, user_id, pack, lume, amount_cents, currency)
  values (p_session, p_user, p_pack, p_lume, p_amount, p_currency)
  on conflict (session_id) do nothing;
  if not found then
    return false;
  end if;
  insert into wallets (user_id, lume) values (p_user, p_lume)
  on conflict (user_id) do update set lume = wallets.lume + excluded.lume, updated_at = now();
  return true;
end $$;

-- Spesa: scala il Lume solo se basta, registra l'oggetto estetico (se c'è) e la consegna, tutto insieme o niente.
create or replace function public.spend_lume(p_user uuid, p_item text, p_cost integer, p_payload jsonb, p_own text)
returns table (grant_id uuid, lume integer) language plpgsql security definer set search_path = public as $$
declare
  left_lume integer;
  gid uuid;
begin
  if p_cost <= 0 then
    raise exception 'bad_cost';
  end if;
  update wallets set lume = wallets.lume - p_cost, updated_at = now()
  where user_id = p_user and wallets.lume >= p_cost
  returning wallets.lume into left_lume;
  if not found then
    raise exception 'insufficient_lume';
  end if;
  if p_own is not null then
    insert into owned (user_id, item) values (p_user, p_own); -- già posseduto = errore = niente scalato
  end if;
  insert into grants (user_id, item, cost, payload) values (p_user, p_item, p_cost, p_payload) returning id into gid;
  return query select gid, left_lume;
end $$;

revoke all on function public.credit_lume(text, uuid, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.spend_lume(uuid, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.credit_lume(text, uuid, text, integer, integer, text) to service_role;
grant execute on function public.spend_lume(uuid, text, integer, jsonb, text) to service_role;
