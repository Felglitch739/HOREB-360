-- Bloque 1: Catálogo editable, auditoría y permisos de reimpresión conservando registros existentes.

create table if not exists public.horeb_audit_logs (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.horeb_branch_state(branch_id),
  actor_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  category text not null check (category in ('precio', 'pago', 'ticket', 'caja', 'operacion')),
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists horeb_audit_logs_branch_idx
  on public.horeb_audit_logs(branch_id, created_at desc);

alter table public.horeb_audit_logs enable row level security;

revoke all on public.horeb_audit_logs from public, anon, authenticated;
grant select on public.horeb_audit_logs to authenticated;
grant select, insert on public.horeb_audit_logs to service_role;

drop policy if exists horeb_audit_members_read on public.horeb_audit_logs;
create policy horeb_audit_members_read on public.horeb_audit_logs
  for select to authenticated using (
    exists (
      select 1 from public.horeb_memberships m
      where m.branch_id = horeb_audit_logs.branch_id
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

  if p_action in ('closeShift','openShift','movement','updateSettings') and membership_role <> 'supervisor' then
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
