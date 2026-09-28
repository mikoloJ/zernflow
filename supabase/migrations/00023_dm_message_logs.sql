-- ============================================================
-- MIGRATION 23: DM MESSAGE LOGS
-- ============================================================
-- Persists inbound DM text locally so broadcasts/segments can filter contacts
-- by keyword ("commented X" already works via comment_logs; this is the DM
-- equivalent). Previously inbound message text was never stored locally —
-- the inbox read it live from Zernio on every page load — so this is new
-- data, not a read path change.
--
-- Only inbound, text-bearing messages are logged (attachment-only messages
-- and outbound sends are skipped — outbound already lives in `messages`).
-- Retention is intentionally left to the operator: this table has no TTL or
-- purge job yet, so anyone enabling keyword filtering should decide how long
-- to keep raw DM text and add a cleanup job if needed.

create extension if not exists pg_trgm;

create table dm_message_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  platform_message_id text not null,
  message_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists dm_message_logs_workspace_id_idx on dm_message_logs (workspace_id);
create index if not exists dm_message_logs_contact_id_idx on dm_message_logs (contact_id);
create index if not exists dm_message_logs_created_at_idx on dm_message_logs (created_at desc);

-- Idempotency: the webhook can redeliver the same message on retry.
create unique index if not exists dm_message_logs_channel_platform_msg_idx
  on dm_message_logs (channel_id, platform_message_id);

-- Keyword search (mirrors the ilike '%...%' pattern comment_logs already
-- uses, just backed by an index this time — comment_logs never got one).
create index if not exists dm_message_logs_text_trgm_idx
  on dm_message_logs using gin (message_text gin_trgm_ops);
