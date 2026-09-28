-- ============================================================
-- MIGRATION 22: CONTACTS - FOLLOWER STATUS
-- ============================================================
-- Lets contacts be segmented by whether they follow the connected Instagram
-- account. null = never checked / not confirmed (Meta's follow-status API
-- only ever confidently confirms "yes"; it never asserts "no"), true =
-- confirmed follower as of last_follower_check_at.

alter table contacts
  add column if not exists is_follower boolean,
  add column if not exists follower_checked_at timestamptz;
