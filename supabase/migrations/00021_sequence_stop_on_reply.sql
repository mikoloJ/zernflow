-- ============================================================
-- MIGRATION 21: SEQUENCES - STOP ON REPLY
-- ============================================================
-- ManyChat-style "DM if no response": a drip sequence should stop
-- following up once the contact actually replies. Defaults to true
-- (the common case) but is a per-sequence toggle since some sequences
-- (e.g. plain broadcasts/announcements) should keep going regardless.

alter table sequences
  add column if not exists stop_on_reply boolean not null default true;
