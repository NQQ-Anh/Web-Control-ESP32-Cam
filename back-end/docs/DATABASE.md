# Supabase schema checked by the backend

Checked read-only against the configured project's Supabase-generated REST OpenAPI on 2026-11-16. The OpenAPI reports the public columns, PostgreSQL types, primary keys, foreign-key descriptions and enum values below. It does not expose RLS policies.

| Table | Primary key | Foreign keys | Columns (PostgreSQL type) |
|---|---|---|---|
| `profiles` | `id` | — | `id uuid`, `full_name varchar`, `role admin_role`, `is_active boolean`, `created_at timestamptz`, `updated_at timestamptz` |
| `access_users` | `id` | `created_by → profiles.id` | `id uuid`, `employee_code varchar`, `full_name varchar`, `email varchar`, `phone varchar`, `department varchar`, `avatar_url text`, `is_active boolean`, `notes text`, `created_by uuid`, `created_at timestamptz`, `updated_at timestamptz` |
| `devices` | `id` | — | `id uuid`, `device_code varchar`, `device_name varchar`, `location varchar`, `status device_status`, `firmware_version varchar`, `last_seen_at timestamptz`, `device_token_hash text`, `is_active boolean`, `created_at timestamptz`, `updated_at timestamptz` |
| `face_enrollments` | `id` | `user_id → access_users.id`, `device_id → devices.id` | `id uuid`, `user_id uuid`, `device_id uuid`, `status enrollment_status`, `template_reference text`, `enrolled_at timestamptz`, `revoked_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz` |
| `access_permissions` | `id` | `user_id → access_users.id`, `device_id → devices.id`, `created_by → profiles.id` | `id uuid`, `user_id uuid`, `device_id uuid`, `valid_from timestamptz`, `valid_until timestamptz`, `is_allowed boolean`, `reason text`, `created_by uuid`, `created_at timestamptz`, `updated_at timestamptz` |
| `access_events` | `id` | `user_id → access_users.id`, `device_id → devices.id` | `id uuid`, `user_id uuid`, `device_id uuid`, `decision access_decision`, `confidence numeric`, `event_source varchar`, `reason text`, `snapshot_path text`, `idempotency_key varchar`, `occurred_at timestamptz`, `created_at timestamptz` |
| `device_commands` | `id` | `device_id → devices.id`, `requested_by → profiles.id` | `id uuid`, `device_id uuid`, `command command_type`, `status command_status`, `payload jsonb`, `requested_by uuid`, `requested_at timestamptz`, `expires_at timestamptz`, `executed_at timestamptz`, `response jsonb`, `error_message text` |
| `device_sync_state` | `device_id` | `device_id → devices.id` | `device_id uuid`, `permission_version bigint`, `last_synced_at timestamptz`, `last_event_synced_at timestamptz`, `updated_at timestamptz` |
| `audit_logs` | `id` | `actor_id → profiles.id` | `id uuid`, `actor_id uuid`, `action text`, `resource_type text`, `resource_id uuid`, `metadata jsonb`, `created_at timestamptz` |

The live enums are `admin_role = (admin, operator, viewer)`, `device_status = (online, offline, maintenance)`, `enrollment_status = (pending, completed, failed, revoked)`, `access_decision = (allowed, denied)`, `command_type = (unlock, sync_permissions, restart)`, and `command_status = (pending, sent, acknowledged, failed, expired)`.

The REST schema showed `audit_logs` and the safety RPC endpoints in the configured project, so the existing audit/safety migrations appear to be installed there. `202611160001_door_state_and_lock_command.sql` is a new additive migration: it adds `devices.door_state` (`text`, default `unknown`), `devices.door_state_updated_at` (`timestamptz`), and the `lock` command enum value. It also replaces the command creation RPC to serialize door commands and reject a second unresolved lock/unlock command. Apply that migration before using the new API fields or lock action.

## Data/API mapping

- Web login identity and role: Supabase Auth plus `profiles`.
- People enrolled for face recognition: `access_users` (not a table named `users`).
- Device credentials: bcrypt hash in `devices.device_token_hash`; raw credential is returned once by Express.
- Face templates/images remain on device; the API does not select `template_reference` or `snapshot_path` for ordinary UI responses.
- Event history: `access_events`; command requests and device ACK results: `device_commands`; synchronization version: `device_sync_state`.
- `/api/history` combines each access event with each command record; request and ACK outcome stay in one command row, so the same door action is not logged twice.
- Browser calls Express. Only the backend uses the Supabase service role key.
