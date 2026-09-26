-- =============================================
-- Inbox: auto-assignment setting, and an index that makes "all the media a
-- contact has sent" fast to query.
-- =============================================

alter table workspaces
  add column if not exists auto_assign_conversations boolean not null default false;

-- Round-robin needs "who was assigned last" per workspace.
alter table workspaces
  add column if not exists last_assigned_member_id uuid references auth.users(id) on delete set null;

-- Messages are usually looked up by conversation; media view scans by
-- workspace across conversations, so give it its own index.
create index if not exists messages_conversation_created_idx
  on messages(conversation_id, created_at desc);
