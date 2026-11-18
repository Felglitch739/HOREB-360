create table public.horeb_branch_state (
  branch_id text primary key check (branch_id in ('lomas', 'trevino', 'sucursal-3')),
  version integer not null default 0 check (version >= 0),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.horeb_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id text not null references public.horeb_branch_state(branch_id),
  role text not null check (role in ('operator','supervisor')),
  primary key (user_id, branch_id)
);
create index horeb_memberships_branch_idx on public.horeb_memberships(branch_id);

create table public.horeb_operations (
  operation_id uuid primary key,
  branch_id text not null references public.horeb_branch_state(branch_id),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  version integer not null,
  created_at timestamptz not null default now(),
  unique (branch_id, version)
);
create index horeb_operations_actor_idx on public.horeb_operations(actor_id);

alter table public.horeb_branch_state enable row level security;
alter table public.horeb_memberships enable row level security;
alter table public.horeb_operations enable row level security;

revoke all on public.horeb_branch_state, public.horeb_memberships, public.horeb_operations from public, anon, authenticated;
grant select on public.horeb_branch_state, public.horeb_memberships to authenticated;
grant select, update on public.horeb_branch_state to service_role;
grant select on public.horeb_memberships to service_role;
grant select, insert on public.horeb_operations to service_role;

create policy horeb_membership_self_read on public.horeb_memberships
  for select to authenticated using ((select auth.uid()) = user_id);
create policy horeb_branch_members_read on public.horeb_branch_state
  for select to authenticated using (exists (
    select 1 from public.horeb_memberships m
    where m.branch_id = horeb_branch_state.branch_id and m.user_id = (select auth.uid())
  ));

insert into public.horeb_branch_state (branch_id) values ('lomas'), ('trevino'), ('sucursal-3');

create function public.horeb_commit_operation(
  p_branch_id text, p_expected_version integer, p_state jsonb,
  p_operation_id uuid, p_actor_id uuid, p_action text
) returns setof public.horeb_branch_state
language plpgsql security invoker set search_path = ''
as $$
declare
  current_row public.horeb_branch_state;
  membership_role text;
begin
  select role into membership_role from public.horeb_memberships
    where user_id = p_actor_id and branch_id = p_branch_id;
  if membership_role is null or (p_action in ('closeShift','openShift','movement') and membership_role <> 'supervisor') then
    return;
  end if;

  select * into current_row from public.horeb_branch_state
    where branch_id = p_branch_id for update;
  if not found then return; end if;

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
