-- Add physical door telemetry and the remote lock command without replacing
-- existing rows, tables, or command history. Apply after 202611040002_safety_rpcs.sql.

alter type public.command_type add value if not exists 'lock';

alter table public.devices
    add column if not exists door_state text not null default 'unknown',
    add column if not exists door_state_updated_at timestamptz;

do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'devices_door_state_check'
           and conrelid = 'public.devices'::regclass
    ) then
        alter table public.devices
            add constraint devices_door_state_check
            check (door_state in ('locked', 'unlocked', 'unknown'));
    end if;
end;
$$;

create or replace function public.create_device_command(
    p_device_id uuid,
    p_command public.command_type,
    p_payload jsonb,
    p_actor_id uuid,
    p_expires_at timestamptz,
    p_online_max_age_seconds integer
)
returns public.device_commands
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.device_commands;
begin
    if p_online_max_age_seconds < 30 or p_online_max_age_seconds > 900 then
        raise exception 'invalid online threshold' using errcode = '22023';
    end if;
    if not exists (
        select 1 from public.devices
         where id = p_device_id and is_active
           and (
               p_command::text not in ('unlock', 'lock')
               or (status = 'online' and last_seen_at >= now() - make_interval(secs => p_online_max_age_seconds))
           )
    ) then
        raise exception 'active online device required' using errcode = '23514';
    end if;
    if p_expires_at <= now() or p_expires_at > now() + interval '5 minutes' then
        raise exception 'invalid command expiration' using errcode = '22023';
    end if;

    if p_command::text in ('unlock', 'lock') then
        -- Serialize door actions and refuse a second action until the first one
        -- has a terminal result. A repeated HTTP request cannot enqueue another
        -- open/close while the device result is uncertain.
        perform pg_advisory_xact_lock(hashtextextended(p_device_id::text || ':door-command', 0));
        update public.device_commands
           set status = 'expired'
         where device_id = p_device_id
           and command::text in ('unlock', 'lock')
           and status in ('pending', 'sent')
           and expires_at < now();
        if exists (
            select 1 from public.device_commands
             where device_id = p_device_id
               and command::text in ('unlock', 'lock')
               and status in ('pending', 'sent')
               and expires_at >= now()
        ) then
            raise exception 'door command already awaiting device result' using errcode = '23505';
        end if;
    end if;

    insert into public.device_commands (device_id, command, status, payload, requested_by, requested_at, expires_at)
    values (p_device_id, p_command, 'pending', coalesce(p_payload, '{}'::jsonb), p_actor_id, now(), p_expires_at)
    returning * into saved;
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, 'device.command.' || p_command::text, 'device_command', saved.id,
            jsonb_build_object('device_id', p_device_id, 'expires_at', p_expires_at));
    return saved;
end;
$$;

revoke all on function public.create_device_command(uuid, public.command_type, jsonb, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.create_device_command(uuid, public.command_type, jsonb, uuid, timestamptz, integer) to service_role;
