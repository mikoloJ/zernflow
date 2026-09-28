"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Users,
  Mail,
  Calendar,
  CheckCircle,
  XCircle,
  Filter,
  ChevronDown,
  UserCheck,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SegmentBuilder,
  createEmptyFilter,
  type SegmentFilter,
} from "@/components/segment-builder";
import { PlatformIcon } from "@/components/platform-icon";
import type { Database } from "@/lib/types/database";

type Tag = Database["public"]["Tables"]["tags"]["Row"];
type ContactWithTags = Database["public"]["Tables"]["contacts"]["Row"] & {
  contact_tags: {
    tag_id: string;
    tags: Tag | null;
  }[];
  contact_channels: {
    platform_sender_id: string;
    channel_id: string;
    channels: { platform: string } | null;
  }[];
};

/** Relative label for the table cell, e.g. "Today · 3:42 PM", "Yesterday · 9:05 AM",
 * or a full date for anything older — the exact instant is always in the label,
 * never hidden behind "Today"/"Yesterday" alone. */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Yesterday · ${time}`;
  if (diffDays < 7) return `${diffDays}d ago · ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · ${time}`;
}

/** Full precision, for the title/tooltip attribute. */
function formatExactDate(dateStr: string | null): string {
  if (!dateStr) return "Never interacted";
  return new Date(dateStr).toLocaleString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ContactsView({
  contacts,
  tags,
  workspaceId,
}: {
  contacts: ContactWithTags[];
  tags: Tag[];
  workspaceId: string;
}) {
  const [search, setSearch] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [showSegmentBuilder, setShowSegmentBuilder] = useState(false);
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>(
    createEmptyFilter()
  );
  const [segmentContactIds, setSegmentContactIds] = useState<Set<string> | null>(
    null
  );
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);

  // A rule counts as "active" once it has a value, or for fields (like
  // "came in through an ad") that don't need one at all.
  const isFilterActive = useMemo(
    () =>
      segmentFilter.groups.some((g) =>
        g.rules.some((r) => r.value !== "" || r.field === "engaged_via_ad")
      ),
    [segmentFilter]
  );

  // Resolve the segment filter server-side (it can reach fields, like tags
  // or follower status, that aren't loaded into this table) whenever it
  // changes, debounced so typing a keyword doesn't fire on every keystroke.
  useEffect(() => {
    if (!isFilterActive) {
      setSegmentContactIds(null);
      setSegmentError(null);
      return;
    }
    let cancelled = false;
    setSegmentLoading(true);
    setSegmentError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/v1/contacts/segment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filter: segmentFilter }),
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || "Could not apply segment");
        setSegmentContactIds(new Set(body.contactIds as string[]));
      } catch (err) {
        if (!cancelled) {
          setSegmentError(err instanceof Error ? err.message : "Could not apply segment");
        }
      } finally {
        if (!cancelled) setSegmentLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [segmentFilter, isFilterActive]);

  const filtered = contacts.filter((contact) => {
    // Search filter
    if (search) {
      const q = search.toLowerCase();
      const name = contact.display_name?.toLowerCase() ?? "";
      const email = contact.email?.toLowerCase() ?? "";
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    // Tag filter (quick pills)
    if (selectedTagId) {
      const hasTag = contact.contact_tags.some(
        (ct) => ct.tag_id === selectedTagId
      );
      if (!hasTag) return false;
    }
    // Segment builder filter
    if (segmentContactIds && !segmentContactIds.has(contact.id)) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Contacts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFilterActive
                ? segmentLoading
                  ? "Applying segment…"
                  : `${filtered.length} of ${contacts.length} contacts match`
                : `${contacts.length} contact${contacts.length !== 1 ? "s" : ""} in your workspace`}
            </p>
          </div>
        </div>

        {/* Search and filters */}
        <div className="mt-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            onClick={() => setShowSegmentBuilder(!showSegmentBuilder)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              showSegmentBuilder || isFilterActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {segmentLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Filter className="h-4 w-4" />
            )}
            Segment
            {isFilterActive && !segmentLoading && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {segmentContactIds?.size ?? 0}
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showSegmentBuilder && "rotate-180"
              )}
            />
          </button>
          {isFilterActive && (
            <button
              type="button"
              onClick={() => setSegmentFilter(createEmptyFilter())}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear segment
            </button>
          )}
        </div>

        {/* Segment builder */}
        {showSegmentBuilder && (
          <div className="mt-4">
            <SegmentBuilder
              value={segmentFilter}
              onChange={setSegmentFilter}
              workspaceId={workspaceId}
            />
            {segmentError && (
              <p className="mt-2 text-xs text-destructive">{segmentError}</p>
            )}
          </div>
        )}

        {/* Tag pills */}
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedTagId(null)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                selectedTagId === null
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              All
            </button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() =>
                  setSelectedTagId(tag.id === selectedTagId ? null : tag.id)
                }
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  selectedTagId === tag.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                )}
                style={
                  tag.color && selectedTagId !== tag.id
                    ? {
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }
                    : undefined
                }
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              No contacts found
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Contacts are created automatically when someone messages your channels
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-8 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Email
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Platform
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Last Interaction
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Tags
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Subscribed
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => {
                const contactTags = contact.contact_tags
                  .map((ct) => ct.tags)
                  .filter(Boolean) as Tag[];

                return (
                  <tr
                    key={contact.id}
                    className="border-b border-border transition-colors hover:bg-accent/50"
                  >
                    <td className="px-8 py-3">
                      <Link
                        href={`/dashboard/contacts/${contact.id}`}
                        className="flex items-center gap-3"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {contact.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={contact.avatar_url}
                              alt={contact.display_name || "Contact"}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            contact.display_name?.[0]?.toUpperCase() ?? "?"
                          )}
                        </div>
                        <span className="text-sm font-medium hover:underline">
                          {contact.display_name ?? "Unknown"}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {contact.email ? (
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {contact.email}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">
                          No email
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {contact.contact_channels.length > 0 ? (
                        <div className="flex items-center gap-1.5">
                          {[
                            ...new Set(
                              contact.contact_channels
                                .map((cc) => cc.channels?.platform)
                                .filter(Boolean) as string[]
                            ),
                          ].map((platform) => (
                            <span
                              key={platform}
                              title={platform}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-muted"
                            >
                              <PlatformIcon platform={platform} className="h-3 w-3" size={12} />
                            </span>
                          ))}
                          {contact.is_follower && (
                            <span
                              title="Follows your account"
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50"
                            >
                              <UserCheck className="h-3 w-3 text-emerald-600" />
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        title={formatExactDate(contact.last_interaction_at)}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground"
                      >
                        <Calendar className="h-3 w-3" />
                        {formatDate(contact.last_interaction_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {contactTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {contactTags.slice(0, 3).map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-medium"
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
                          {contactTags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{contactTags.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">
                          No tags
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {contact.is_subscribed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                          <CheckCircle className="h-3.5 w-3.5" />
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          <XCircle className="h-3.5 w-3.5" />
                          No
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
