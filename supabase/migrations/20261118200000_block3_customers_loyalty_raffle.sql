-- Bloque 3: Clientes, programa de lealtad idempotente (10 combos -> combo gratis -> boleto rifa) y sorteos.
-- Conserva todos los registros existentes y aplica restricciones UNIQUE en BD para impedir duplicados.

alter table public.horeb_audit_logs
  drop constraint if exists horeb_audit_logs_category_check;

alter table public.horeb_audit_logs
  add constraint horeb_audit_logs_category_check
  check (category in ('precio', 'pago', 'ticket', 'caja', 'operacion', 'equipo', 'aviso', 'lealtad', 'rifa'));

create table if not exists public.horeb_customers (
  id text primary key,
  name text not null,
  phone text not null,
  contact_consent boolean not null default false,
  combos_toward_free integer not null default 0 check (combos_toward_free >= 0),
  free_combos_available integer not null default 0 check (free_combos_available >= 0),
  created_branch_id text references public.horeb_branch_state(branch_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists horeb_customers_phone_uq
  on public.horeb_customers(phone);

create table if not exists public.horeb_loyalty_events (
  id text primary key,
  customer_id text not null references public.horeb_customers(id) on delete cascade,
  order_id text not null,
  branch_id text not null references public.horeb_branch_state(branch_id),
  event_type text not null check (event_type in ('combos_earned', 'free_combo_unlocked', 'free_combo_redeemed', 'raffle_ticket_issued')),
  delta integer not null,
  note text,
  created_at timestamptz not null default now(),
  unique (order_id, event_type)
);

create index if not exists horeb_loyalty_events_customer_idx
  on public.horeb_loyalty_events(customer_id, created_at desc);

create table if not exists public.horeb_raffle_tickets (
  id text primary key,
  ticket_code text not null,
  year integer not null,
  customer_id text not null references public.horeb_customers(id) on delete cascade,
  customer_name text not null,
  customer_phone text not null,
  order_id text not null unique,
  order_folio text not null,
  branch_id text not null references public.horeb_branch_state(branch_id),
  issued_at timestamptz not null default now()
);

create index if not exists horeb_raffle_tickets_year_idx
  on public.horeb_raffle_tickets(year, issued_at desc);

create table if not exists public.horeb_raffle_draws (
  id text primary key,
  year integer not null,
  drawn_at timestamptz not null default now(),
  drawn_by text not null,
  winner_ticket_id text not null references public.horeb_raffle_tickets(id),
  winner_ticket_code text not null,
  winner_customer_id text not null references public.horeb_customers(id),
  winner_customer_name text not null,
  winner_customer_phone text not null,
  eligible_tickets_count integer not null check (eligible_tickets_count > 0),
  notes text
);

alter table public.horeb_customers enable row level security;
alter table public.horeb_loyalty_events enable row level security;
alter table public.horeb_raffle_tickets enable row level security;
alter table public.horeb_raffle_draws enable row level security;

revoke all on public.horeb_customers, public.horeb_loyalty_events, public.horeb_raffle_tickets, public.horeb_raffle_draws from public, anon, authenticated;
grant select on public.horeb_customers, public.horeb_loyalty_events, public.horeb_raffle_tickets, public.horeb_raffle_draws to authenticated;
grant select, insert, update on public.horeb_customers, public.horeb_loyalty_events, public.horeb_raffle_tickets, public.horeb_raffle_draws to service_role;

drop policy if exists horeb_customers_members_read on public.horeb_customers;
create policy horeb_customers_members_read on public.horeb_customers
  for select to authenticated using (
    exists (select 1 from public.horeb_memberships m where m.user_id = (select auth.uid()))
  );

drop policy if exists horeb_loyalty_members_read on public.horeb_loyalty_events;
create policy horeb_loyalty_members_read on public.horeb_loyalty_events
  for select to authenticated using (
    exists (select 1 from public.horeb_memberships m where m.user_id = (select auth.uid()))
  );

drop policy if exists horeb_raffle_tickets_members_read on public.horeb_raffle_tickets;
create policy horeb_raffle_tickets_members_read on public.horeb_raffle_tickets
  for select to authenticated using (
    exists (select 1 from public.horeb_memberships m where m.user_id = (select auth.uid()))
  );

drop policy if exists horeb_raffle_draws_members_read on public.horeb_raffle_draws;
create policy horeb_raffle_draws_members_read on public.horeb_raffle_draws
  for select to authenticated using (
    exists (select 1 from public.horeb_memberships m where m.user_id = (select auth.uid()))
  );

create or replace function public.horeb_commit_operation(
  p_branch_id text, p_expected_version integer, p_state jsonb,
  p_operation_id uuid, p_actor_id uuid, p_action text
) returns setof public.horeb_branch_state
language plpgsql security invoker set search_path = ''
as $$
declare
  current_row public.horeb_branch_state;
  membership_role text;
  allow_op_reprint boolean;
begin
  select role into membership_role from public.horeb_memberships
    where user_id = p_actor_id and branch_id = p_branch_id;
  if membership_role is null then
    return;
  end if;

  if p_action in (
    'closeShift', 'openShift', 'movement', 'updateSettings',
    'upsertMachine', 'deleteMachine', 'seedSampleMachines',
    'runRaffleDraw', 'seedSampleCustomers'
  ) and membership_role <> 'supervisor' then
    return;
  end if;

  select * into current_row from public.horeb_branch_state
    where branch_id = p_branch_id for update;
  if not found then return; end if;

  if p_action = 'reprint' and membership_role <> 'supervisor' then
    allow_op_reprint := coalesce((current_row.state->'settings'->p_branch_id->>'allowOperatorReprint')::boolean, false);
    if not allow_op_reprint then
      return;
    end if;
  end if;

  if exists (select 1 from public.horeb_operations
    where operation_id = p_operation_id and branch_id = p_branch_id and actor_id = p_actor_id) then
    return next current_row;
    return;
  end if;

  if current_row.version <> p_expected_version then return; end if;

  update public.horeb_branch_state
    set state = p_state, version = version + 1, updated_at = now()
    where branch_id = p_branch_id returning * into current_row;
  insert into public.horeb_operations (operation_id, branch_id, actor_id, action, version)
    values (p_operation_id, p_branch_id, p_actor_id, p_action, current_row.version);
  return next current_row;
end;
$$;

revoke all on function public.horeb_commit_operation(text, integer, jsonb, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.horeb_commit_operation(text, integer, jsonb, uuid, uuid, text) to service_role;
