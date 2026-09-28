-- ============================================================
-- MIGRATION 24: CONVERSATION NOTES
-- ============================================================
-- Internal notes attached to a conversation (ManyChat's "Note" composer
-- tab): visible to the team, never sent to the contact. Rendered inline in
-- the thread alongside messages, distinguished by having no `direction`.

create table conversation_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversation_notes_conversation_id_idx
  on conversation_notes (conversation_id, created_at);

alter table conversation_notes enable row level security;

create policy "Users can view notes in their workspaces"
  on conversation_notes for select
  using (is_workspace_member(workspace_id));

create policy "Users can insert notes in their workspaces"
  on conversation_notes for insert
  with check (is_workspace_member(workspace_id));

create policy "Users can delete notes in their workspaces"
  on conversation_notes for delete
  using (is_workspace_member(workspace_id));
