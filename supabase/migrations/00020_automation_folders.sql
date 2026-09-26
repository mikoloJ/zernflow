-- =============================================
-- Automations hub: folders to organize flows and comment automations
-- together (ManyChat-style "My Automations" list with folders).
-- =============================================

create table if not exists automation_folders (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_automation_folders_workspace
  on automation_folders(workspace_id);

alter table automation_folders enable row level security;

create policy "Members can view automation folders"
  on automation_folders for select
  using (is_workspace_member(workspace_id));

create policy "Members can manage automation folders"
  on automation_folders for all
  using (is_workspace_member(workspace_id));

-- Which folder each automation belongs to (null = unfiled).
alter table flows
  add column if not exists folder_id uuid references automation_folders(id) on delete set null;

alter table comment_automations
  add column if not exists folder_id uuid references automation_folders(id) on delete set null;

create index if not exists idx_flows_folder on flows(folder_id);
create index if not exists idx_comment_automations_folder on comment_automations(folder_id);
