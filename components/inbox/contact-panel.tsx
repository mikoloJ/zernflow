"use client";

import { useState, useEffect } from "react";
import {
  X,
  Mail,
  Calendar,
  Tag,
  User,
  Hash,
  UserCircle,
  Image as ImageIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { Avatar } from "@/components/inbox/avatar";
import type { Database, Platform } from "@/lib/types/database";

type TeamMember = { userId: string; role: string; email: string; name: string };

/** Attachment shape as stored in messages.extra (see lib/inbox-messages.ts). */
interface MediaAttachment {
  type: string;
  url?: string;
  previewUrl?: string;
  filename?: string;
}

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type TagRow = Database["public"]["Tables"]["tags"]["Row"];
type CustomFieldDef =
  Database["public"]["Tables"]["custom_field_definitions"]["Row"];
type CustomFieldValue =
  Database["public"]["Tables"]["contact_custom_fields"]["Row"];

interface ContactDetails {
  contact: Contact;
  tags: TagRow[];
  customFields: { definition: CustomFieldDef; value: string }[];
  channels: {
    platform: Platform;
    platform_username: string | null;
  }[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ContactPanel({
  contactId,
  conversationId,
  assignedTo,
  workspaceId,
  onClose,
}: {
  contactId: string | null;
  conversationId?: string | null;
  assignedTo?: string | null;
  workspaceId: string;
  onClose: () => void;
}) {
  const [loadedDetails, setDetails] = useState<ContactDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"info" | "media">("info");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [media, setMedia] = useState<MediaAttachment[] | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [localAssignedTo, setLocalAssignedTo] = useState(assignedTo ?? null);
  // Re-sync from the prop when a different conversation is selected (React's
  // "adjusting state when a prop changes" pattern — during render, not in an
  // effect, so a stale value never flashes).
  const [syncedFor, setSyncedFor] = useState(conversationId);
  if (syncedFor !== conversationId) {
    setSyncedFor(conversationId);
    setLocalAssignedTo(assignedTo ?? null);
  }

  useEffect(() => {
    fetch("/api/v1/team/members")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMembers(d?.members ?? []))
      .catch(() => {});
  }, []);

  // New contact/conversation selected: reset the tab and cached media (same
  // during-render pattern as the assignment sync above).
  if (syncedFor !== conversationId) {
    setTab("info");
    setMedia(null);
  }

  useEffect(() => {
    if (tab !== "media" || !conversationId || media !== null) return;
    async function loadMedia() {
      setMediaLoading(true);
      try {
        const res = await fetch(`/api/v1/messages?conversationId=${conversationId}`);
        const msgs: Array<{
          extra?: { attachments?: MediaAttachment[]; storyReply?: { url?: string | null } | null; isStoryMention?: boolean };
        }> = res.ok ? await res.json() : [];
        const items: MediaAttachment[] = [];
        for (const m of msgs ?? []) {
          for (const a of m.extra?.attachments ?? []) {
            if ((a.type === "image" || a.type === "video") && (a.url || a.previewUrl)) items.push(a);
          }
          if (m.extra?.isStoryMention && m.extra.storyReply?.url) {
            items.push({ type: "image", url: m.extra.storyReply.url });
          }
        }
        setMedia(items);
      } catch {
        setMedia([]);
      } finally {
        setMediaLoading(false);
      }
    }
    loadMedia();
  }, [tab, conversationId, media]);

  async function assignTo(userId: string | null) {
    if (!conversationId) return;
    setAssigning(true);
    setLocalAssignedTo(userId);
    await createClient().from("conversations").update({ assigned_to: userId }).eq("id", conversationId);
    setAssigning(false);
  }

  useEffect(() => {
    if (!contactId) return;

    async function loadContact() {
      setLoading(true);
      const supabase = createClient();

      const [contactRes, tagsRes, fieldsRes, channelsRes] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", contactId!).single(),
        supabase
          .from("contact_tags")
          .select("tag_id, tags(*)")
          .eq("contact_id", contactId!),
        supabase
          .from("contact_custom_fields")
          .select("*, custom_field_definitions(*)")
          .eq("contact_id", contactId!),
        supabase
          .from("contact_channels")
          .select("platform_username, channels(platform)")
          .eq("contact_id", contactId!),
      ]);

      if (contactRes.data) {
        const tags = (tagsRes.data ?? [])
          .map((ct) => ct.tags)
          .filter(Boolean) as TagRow[];

        const customFields = (fieldsRes.data ?? [])
          .map((cf) => ({
            definition: cf.custom_field_definitions as unknown as CustomFieldDef,
            value: cf.value,
          }))
          .filter((cf) => cf.definition);

        const channels = (channelsRes.data ?? []).map((cc) => ({
          platform: (cc.channels as unknown as { platform: Platform }).platform,
          platform_username: cc.platform_username,
        }));

        setDetails({
          contact: contactRes.data,
          tags,
          customFields,
          channels,
        });
      }

      setLoading(false);
    }

    loadContact();
  }, [contactId, workspaceId]);

  if (!contactId) return null;

  const details =
    loadedDetails?.contact.id === contactId ? loadedDetails : null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h3 className="text-sm font-semibold">Contact Info</h3>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      {conversationId && (
        <div className="flex border-b border-border px-4">
          {(["info", "media"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors",
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "media" ? "Media" : "Info"}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : tab === "media" ? (
        <div className="flex-1 overflow-y-auto p-4">
          {mediaLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          ) : !media || media.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
              <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2">No photos or videos yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {media.map((m, i) => (
                <a
                  key={i}
                  href={m.url ?? m.previewUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative aspect-square overflow-hidden rounded-md bg-muted"
                >
                  {m.type === "video" ? (
                    <video src={m.url ?? undefined} className="h-full w-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url ?? m.previewUrl ?? ""} alt="" className="h-full w-full object-cover" />
                  )}
                  {m.type === "video" && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[9px] font-medium text-white">
                      Video
                    </span>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      ) : details ? (
        <div className="flex-1 overflow-y-auto">
          {/* Profile section */}
          <div className="flex flex-col items-center border-b border-border p-6">
            <Avatar
              src={details.contact.avatar_url}
              name={details.contact.display_name}
              className="h-16 w-16 text-xl font-semibold"
            />
            <p className="mt-3 text-sm font-semibold">
              {details.contact.display_name ?? "Unknown"}
            </p>
            {details.contact.email && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {details.contact.email}
              </p>
            )}
            <span
              className={cn(
                "mt-2 rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                details.contact.is_subscribed
                  ? "bg-green-100 text-green-700"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {details.contact.is_subscribed ? "Subscribed" : "Unsubscribed"}
            </span>
          </div>

          {/* Details */}
          <div className="space-y-4 p-4">
            {/* Assignment */}
            {conversationId && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <UserCircle className="h-3 w-3" />
                  Assigned To
                </h4>
                <select
                  value={localAssignedTo ?? ""}
                  disabled={assigning}
                  onChange={(e) => assignTo(e.target.value || null)}
                  className="mt-1.5 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Connected platforms */}
            {details.channels.length > 0 && (
              <div>
                <h4 className="text-xs font-medium uppercase text-muted-foreground">
                  Platforms
                </h4>
                <div className="mt-2 space-y-1.5">
                  {details.channels.map((ch, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm"
                    >
                      <PlatformIcon
                        platform={ch.platform}
                        className="h-3.5 w-3.5"
                        size={14}
                      />
                      <span className="capitalize text-muted-foreground">
                        {ch.platform}
                      </span>
                      {ch.platform_username && (
                        <span className="truncate text-foreground">
                          @{ch.platform_username}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email */}
            {details.contact.email && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  Email
                </h4>
                <p className="mt-1 text-sm">{details.contact.email}</p>
              </div>
            )}

            {/* Last interaction */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Last Interaction
              </h4>
              <p className="mt-1 text-sm">
                {formatDate(details.contact.last_interaction_at)}
              </p>
            </div>

            {/* Joined */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <User className="h-3 w-3" />
                Created
              </h4>
              <p className="mt-1 text-sm">
                {formatDate(details.contact.created_at)}
              </p>
            </div>

            {/* Tags */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <Tag className="h-3 w-3" />
                Tags
              </h4>
              {details.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {details.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs"
                      style={
                        tag.color
                          ? {
                              backgroundColor: `${tag.color}20`,
                              borderColor: `${tag.color}40`,
                              color: tag.color,
                            }
                          : undefined
                      }
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">No tags</p>
              )}
            </div>

            {/* Custom fields */}
            {details.customFields.length > 0 && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  Custom Fields
                </h4>
                <div className="mt-2 space-y-2">
                  {details.customFields.map((cf) => (
                    <div key={cf.definition.id}>
                      <p className="text-xs text-muted-foreground">
                        {cf.definition.name}
                      </p>
                      <p className="text-sm">{cf.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Contact not found
        </div>
      )}
    </div>
  );
}
