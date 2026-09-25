-- =============================================
-- Comment automations (ManyChat-style "comment -> DM" quick automations)
-- One row = one self-contained automation: which account + post(s), which
-- keywords, the public replies, the opening DM (with a button) and the DM with
-- links. Handled directly by the comment webhook and the button-tap (postback)
-- webhook, independent of the flow builder.
-- =============================================

create table if not exists comment_automations (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid references channels(id) on delete cascade,
  name text not null default 'Untitled automation',
  is_active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  comments_matched integer not null default 0,
  replies_posted integer not null default 0,
  opening_dms_sent integer not null default 0,
  button_taps integer not null default 0,
  link_dms_sent integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comment_automations_workspace
  on comment_automations(workspace_id);
create index if not exists idx_comment_automations_channel
  on comment_automations(channel_id) where is_active;

create trigger set_updated_at before update on comment_automations
  for each row execute function update_updated_at();

alter table comment_automations enable row level security;

create policy "Members can view comment automations"
  on comment_automations for select
  using (is_workspace_member(workspace_id));

create policy "Members can create comment automations"
  on comment_automations for insert
  with check (is_workspace_member(workspace_id));

create policy "Members can update comment automations"
  on comment_automations for update
  using (is_workspace_member(workspace_id));

create policy "Members can delete comment automations"
  on comment_automations for delete
  using (is_workspace_member(workspace_id));

-- Atomic stat counter bump (called by the webhook with the service role).
create or replace function bump_comment_automation_stat(automation_id uuid, stat text)
returns void as $$
begin
  if stat not in ('comments_matched', 'replies_posted', 'opening_dms_sent', 'button_taps', 'link_dms_sent') then
    raise exception 'unknown stat %', stat;
  end if;
  execute format(
    'update comment_automations set %I = %I + 1 where id = $1',
    stat, stat
  ) using automation_id;
end;
$$ language plpgsql security definer;

revoke execute on function bump_comment_automation_stat(uuid, text) from public, anon, authenticated;

-- Which automation handled a comment (for the activity log).
alter table comment_logs
  add column if not exists matched_automation_id uuid references comment_automations(id) on delete set null;
