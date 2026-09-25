-- =============================================
-- Inbox: where a conversation came from (ad click attribution), and a
-- public storage bucket for images/files sent from the inbox composer.
-- =============================================

-- Ad-click attribution captured from the first inbound message's referral
-- (Instagram Click-to-Direct, Messenger Click-to-Message, Click-to-WhatsApp).
alter table conversations
  add column if not exists source jsonb;

-- Media sent from the inbox must be at a public URL for Meta to fetch it.
insert into storage.buckets (id, name, public)
values ('inbox-media', 'inbox-media', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Members can upload inbox media'
  ) then
    create policy "Members can upload inbox media"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'inbox-media');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Anyone can read inbox media'
  ) then
    create policy "Anyone can read inbox media"
      on storage.objects for select
      using (bucket_id = 'inbox-media');
  end if;
end $$;
