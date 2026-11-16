-- Transactional operations used by the API. Apply after 202611040001_audit_logs.sql.
-- Execute privileges are limited to the backend service role; clients must use Express.

create or replace function public.bump_device_permission_version(p_device_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    next_version bigint;
begin
    insert into public.device_sync_state (device_id, permission_version, updated_at)
    values (p_device_id, 1, now())
    on conflict (device_id) do update
      set permission_version = public.device_sync_state.permission_version + 1,
          updated_at = now()
    returning permission_version into next_version;
    return next_version;
end;
$$;

create or replace function public.save_access_permission(
    p_id uuid,
    p_user_id uuid,
    p_device_id uuid,
    p_valid_from timestamptz,
    p_valid_until timestamptz,
    p_is_allowed boolean,
    p_reason text,
    p_actor_id uuid
)
returns public.access_permissions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.access_permissions;
    previous_device_id uuid;
    previous_is_allowed boolean;
begin
    if p_valid_until is not null and p_valid_until <= p_valid_from then
        raise exception 'valid_until must be after valid_from' using errcode = '22023';
    end if;
    if p_is_allowed and not exists (select 1 from public.access_users where id = p_user_id and is_active) then
        raise exception 'active access user required' using errcode = '23514';
    end if;
    if p_is_allowed and not exists (select 1 from public.devices where id = p_device_id and is_active) then
        raise exception 'active device required' using errcode = '23514';
    end if;

    if p_id is null then
        insert into public.access_permissions (user_id, device_id, valid_from, valid_until, is_allowed, reason, created_by)
        values (p_user_id, p_device_id, p_valid_from, p_valid_until, p_is_allowed, p_reason, p_actor_id)
        returning * into saved;
    else
        select device_id, is_allowed into previous_device_id, previous_is_allowed from public.access_permissions where id = p_id for update;
        if not found then raise exception 'permission not found' using errcode = 'P0002'; end if;
        update public.access_permissions
           set user_id = p_user_id,
               device_id = p_device_id,
               valid_from = p_valid_from,
               valid_until = p_valid_until,
               is_allowed = p_is_allowed,
               reason = p_reason,
               updated_at = now()
         where id = p_id
         returning * into saved;
        if previous_device_id <> p_device_id then
            perform public.bump_device_permission_version(previous_device_id);
        end if;
    end if;

    perform public.bump_device_permission_version(saved.device_id);
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id,
            case when p_id is null then 'access_permission.create'
                 when previous_is_allowed and not saved.is_allowed then 'access_permission.revoke'
                 else 'access_permission.update' end,
            'access_permission', saved.id,
            jsonb_build_object('device_id', saved.device_id, 'user_id', saved.user_id, 'is_allowed', saved.is_allowed));
    return saved;
end;
$$;

create or replace function public.set_access_user_active(p_user_id uuid, p_is_active boolean, p_actor_id uuid)
returns public.access_users
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.access_users;
    affected_device record;
begin
    update public.access_users set is_active = p_is_active, updated_at = now()
     where id = p_user_id returning * into saved;
    if not found then raise exception 'access user not found' using errcode = 'P0002'; end if;

    for affected_device in
        select distinct device_id from public.access_permissions where user_id = p_user_id
    loop
        perform public.bump_device_permission_version(affected_device.device_id);
    end loop;

    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, case when p_is_active then 'access_user.activate' else 'access_user.deactivate' end,
            'access_user', p_user_id, '{}'::jsonb);
    return saved;
end;
$$;

create or replace function public.request_face_enrollment(p_user_id uuid, p_device_id uuid, p_actor_id uuid)
returns public.face_enrollments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.face_enrollments;
begin
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_device_id::text, 0));
    if not exists (select 1 from public.access_users where id = p_user_id and is_active) then
        raise exception 'active access user required' using errcode = '23514';
    end if;
    if not exists (select 1 from public.devices where id = p_device_id and is_active) then
        raise exception 'active device required' using errcode = '23514';
    end if;
    if exists (select 1 from public.face_enrollments where user_id = p_user_id and device_id = p_device_id and status = 'pending') then
        raise exception 'pending enrollment already exists' using errcode = '23505';
    end if;
    insert into public.face_enrollments (user_id, device_id, status)
    values (p_user_id, p_device_id, 'pending') returning * into saved;
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, 'face_enrollment.request', 'face_enrollment', saved.id, jsonb_build_object('device_id', p_device_id));
    return saved;
end;
$$;

create or replace function public.revoke_face_enrollment(p_enrollment_id uuid, p_actor_id uuid)
returns public.face_enrollments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.face_enrollments;
begin
    select * into saved
      from public.face_enrollments
     where id = p_enrollment_id
     for update;
    if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
    if saved.status = 'revoked' then return saved; end if;
    update public.face_enrollments
       set status = 'revoked', revoked_at = now(), updated_at = now()
     where id = p_enrollment_id
     returning * into saved;
    if saved.device_id is not null then perform public.bump_device_permission_version(saved.device_id); end if;
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, 'face_enrollment.revoke', 'face_enrollment', saved.id, jsonb_build_object('device_id', saved.device_id));
    return saved;
end;
$$;

create or replace function public.complete_face_enrollment(
    p_enrollment_id uuid,
    p_device_id uuid,
    p_status public.enrollment_status
)
returns public.face_enrollments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.face_enrollments;
begin
    if p_status not in ('completed', 'failed') then
        raise exception 'invalid device enrollment result' using errcode = '22023';
    end if;
    update public.face_enrollments
       set status = p_status,
           enrolled_at = case when p_status = 'completed' then now() else null end,
           updated_at = now()
     where id = p_enrollment_id and device_id = p_device_id and status = 'pending'
     returning * into saved;
    if not found then
        select * into saved from public.face_enrollments where id = p_enrollment_id and device_id = p_device_id;
        if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
        if saved.status = p_status then return saved; end if;
        raise exception 'enrollment already processed' using errcode = '23514';
    end if;
    perform public.bump_device_permission_version(p_device_id);
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (null, 'face_enrollment.device_result', 'face_enrollment', saved.id,
            jsonb_build_object('device_id', p_device_id, 'status', p_status::text));
    return saved;
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
               p_command <> 'unlock'
               or (status = 'online' and last_seen_at >= now() - make_interval(secs => p_online_max_age_seconds))
           )
    ) then
        raise exception 'active device required' using errcode = '23514';
    end if;
    if p_expires_at <= now() or p_expires_at > now() + interval '5 minutes' then
        raise exception 'invalid command expiration' using errcode = '22023';
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

create or replace function public.create_access_device(
    p_device_code text,
    p_device_name text,
    p_location text,
    p_firmware_version text,
    p_device_token_hash text,
    p_actor_id uuid
)
returns public.devices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.devices;
begin
    insert into public.devices (device_code, device_name, location, firmware_version, device_token_hash, status, is_active)
    values (p_device_code, p_device_name, p_location, p_firmware_version, p_device_token_hash, 'offline', true)
    returning * into saved;
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, 'device.create', 'device', saved.id, jsonb_build_object('device_code', saved.device_code));
    return saved;
end;
$$;

create or replace function public.set_device_active(p_device_id uuid, p_is_active boolean, p_actor_id uuid)
returns public.devices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.devices;
begin
    update public.devices set is_active = p_is_active, status = 'offline', updated_at = now()
     where id = p_device_id returning * into saved;
    if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
    if not p_is_active then
        update public.device_commands set status = 'expired'
         where device_id = p_device_id and status in ('pending', 'sent');
    end if;
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, case when p_is_active then 'device.activate' else 'device.deactivate' end,
            'device', p_device_id, '{}'::jsonb);
    return saved;
end;
$$;

create or replace function public.rotate_device_credential(p_device_id uuid, p_device_token_hash text, p_actor_id uuid)
returns public.devices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.devices;
begin
    update public.devices set device_token_hash = p_device_token_hash, updated_at = now()
     where id = p_device_id returning * into saved;
    if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, 'device.credential.rotate', 'device', p_device_id, '{}'::jsonb);
    return saved;
end;
$$;

create or replace function public.acknowledge_device_command(
    p_command_id uuid,
    p_device_id uuid,
    p_status public.command_status,
    p_response jsonb,
    p_error_message text
)
returns public.device_commands
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    saved public.device_commands;
begin
    if p_status not in ('acknowledged', 'failed') then
        raise exception 'invalid command acknowledgment' using errcode = '22023';
    end if;
    select * into saved from public.device_commands
     where id = p_command_id and device_id = p_device_id for update;
    if not found then raise exception 'command not found' using errcode = 'P0002'; end if;
    if saved.status = p_status then return saved; end if;
    if saved.status not in ('pending', 'sent') then raise exception 'command already processed' using errcode = '23514'; end if;
    if saved.expires_at is not null and saved.expires_at < now() then
        update public.device_commands set status = 'expired' where id = p_command_id returning * into saved;
        return saved;
    end if;

    update public.device_commands
       set status = p_status,
           response = p_response,
           error_message = p_error_message,
           executed_at = now()
     where id = p_command_id
     returning * into saved;
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (saved.requested_by, 'device.command.acknowledge', 'device_command', saved.id,
            jsonb_build_object('device_id', p_device_id, 'status', p_status::text));
    return saved;
end;
$$;

revoke all on function public.bump_device_permission_version(uuid) from public, anon, authenticated;
revoke all on function public.save_access_permission(uuid, uuid, uuid, timestamptz, timestamptz, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.set_access_user_active(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.request_face_enrollment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.revoke_face_enrollment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_face_enrollment(uuid, uuid, public.enrollment_status) from public, anon, authenticated;
revoke all on function public.create_device_command(uuid, public.command_type, jsonb, uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.create_access_device(text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.set_device_active(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.rotate_device_credential(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.acknowledge_device_command(uuid, uuid, public.command_status, jsonb, text) from public, anon, authenticated;

grant execute on function public.bump_device_permission_version(uuid) to service_role;
grant execute on function public.save_access_permission(uuid, uuid, uuid, timestamptz, timestamptz, boolean, text, uuid) to service_role;
grant execute on function public.set_access_user_active(uuid, boolean, uuid) to service_role;
grant execute on function public.request_face_enrollment(uuid, uuid, uuid) to service_role;
grant execute on function public.revoke_face_enrollment(uuid, uuid) to service_role;
grant execute on function public.complete_face_enrollment(uuid, uuid, public.enrollment_status) to service_role;
grant execute on function public.create_device_command(uuid, public.command_type, jsonb, uuid, timestamptz, integer) to service_role;
grant execute on function public.create_access_device(text, text, text, text, text, uuid) to service_role;
grant execute on function public.set_device_active(uuid, boolean, uuid) to service_role;
grant execute on function public.rotate_device_credential(uuid, text, uuid) to service_role;
grant execute on function public.acknowledge_device_command(uuid, uuid, public.command_status, jsonb, text) to service_role;
