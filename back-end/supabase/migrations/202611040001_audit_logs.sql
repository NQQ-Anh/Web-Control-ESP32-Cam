-- Apply manually after reviewing. The API server writes through its service key;
-- direct client access is intentionally denied by RLS (there are no client policies).
create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references public.profiles(id) on delete set null,
    action text not null,
    resource_type text not null,
    resource_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

grant select, insert on public.audit_logs to service_role;

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id, created_at desc);
