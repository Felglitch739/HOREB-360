-- Bloque 4: Cierre nocturno 23:00 por sucursal con unicidad (branch_id, closing_date) y bandeja de transferencias.

alter table public.horeb_audit_logs
  drop constraint if exists horeb_audit_logs_category_check;

alter table public.horeb_audit_logs
  add constraint horeb_audit_logs_category_check
  check (category in (
    'precio', 'pago', 'ticket', 'caja', 'operacion',
    'equipo', 'aviso', 'lealtad', 'rifa', 'cierre_nocturno', 'conciliacion'
  ));

create table if not exists public.horeb_night_closings (
  id text primary key,
  branch_id text not null references public.horeb_branch_state(branch_id),
  closing_date date not null,
  shift_id text,
  shift_number integer,
  was_auto_closed boolean not null default false,
  expected_cash_cents integer not null default 0,
  counted_cash_cents integer not null default 0,
  confirmed_card_cents integer not null default 0,
  confirmed_transfer_cents integer not null default 0,
  pending_transfer_cents integer not null default 0,
  pending_balance_cents integer not null default 0,
  pending_delivery_count integer not null default 0,
  pending_delivery_amount_cents integer not null default 0,
  total_confirmed_cents integer not null default 0,
  report_text text not null,
  executed_at timestamptz not null default now(),
  executed_by text not null,
  unique (branch_id, closing_date)
);

create index if not exists horeb_night_closings_date_idx
  on public.horeb_night_closings(closing_date desc, branch_id);

alter table public.horeb_night_closings enable row level security;

revoke all on public.horeb_night_closings from public, anon, authenticated;
grant select on public.horeb_night_closings to authenticated;
grant select, insert, update on public.horeb_night_closings to service_role;

drop policy if exists horeb_night_closings_members_read on public.horeb_night_closings;
create policy horeb_night_closings_members_read on public.horeb_night_closings
  for select to authenticated using (
    exists (
      select 1 from public.horeb_memberships m
      where m.branch_id = horeb_night_closings.branch_id
        and m.user_id = (select auth.uid())
    )
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
    'runRaffleDraw', 'seedSampleCustomers', 'runNightClosing'
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
