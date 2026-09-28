import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Platform } from "@/lib/types/database";

// Shared by the Contacts page's segment builder and Broadcasts' audience
// targeting, so a filter behaves identically (and gets fixed) in both places.

export interface SegmentRule {
  field: string;
  operator: string;
  value: string;
}

export interface SegmentGroup {
  combinator: "and" | "or";
  rules: SegmentRule[];
}

export interface SegmentFilter {
  combinator: "and" | "or";
  groups: SegmentGroup[];
}

/**
 * Resolve a segment filter into matching contact IDs.
 * `subscribedOnly` narrows to is_subscribed=true (broadcasts should never
 * message unsubscribed contacts); the Contacts page passes false so an
 * unsubscribed contact can still be found by other filters.
 */
export async function resolveContacts(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  filter: SegmentFilter | null,
  options: { subscribedOnly?: boolean } = {}
): Promise<string[]> {
  let base = supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId);
  if (options.subscribedOnly) base = base.eq("is_subscribed", true);

  const { data: allContacts } = await base.limit(10000);
  if (!allContacts?.length) return [];
  const allIds = new Set(allContacts.map((c) => c.id));

  if (!filter || !filter.groups?.length) return Array.from(allIds);

  const groupResults: Set<string>[] = [];
  for (const group of filter.groups) {
    const ruleResults: Set<string>[] = [];
    for (const rule of group.rules) {
      ruleResults.push(await evaluateRule(supabase, workspaceId, rule, allIds));
    }
    groupResults.push(
      group.combinator === "and" ? intersectSets(ruleResults) : unionSets(ruleResults)
    );
  }

  return Array.from(
    filter.combinator === "and" ? intersectSets(groupResults) : unionSets(groupResults)
  );
}

async function evaluateRule(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  rule: SegmentRule,
  allContactIds: Set<string>
): Promise<Set<string>> {
  const contactIds = Array.from(allContactIds);

  switch (rule.field) {
    case "has_tag": {
      const { data: tag } = await supabase
        .from("tags")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", rule.value)
        .single();
      if (!tag) return new Set();
      const { data: tagged } = await supabase
        .from("contact_tags")
        .select("contact_id")
        .eq("tag_id", tag.id)
        .in("contact_id", contactIds);
      return new Set((tagged ?? []).map((t) => t.contact_id));
    }

    case "missing_tag": {
      const { data: tag } = await supabase
        .from("tags")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", rule.value)
        .single();
      if (!tag) return new Set(contactIds);
      const { data: tagged } = await supabase
        .from("contact_tags")
        .select("contact_id")
        .eq("tag_id", tag.id)
        .in("contact_id", contactIds);
      const taggedSet = new Set((tagged ?? []).map((t) => t.contact_id));
      return new Set(contactIds.filter((id) => !taggedSet.has(id)));
    }

    case "platform": {
      const { data: channels } = await supabase
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("platform", rule.value as Platform);
      if (!channels?.length) {
        return rule.operator === "not_equals" ? new Set(contactIds) : new Set();
      }
      const channelIds = channels.map((c) => c.id);
      const { data: links } = await supabase
        .from("contact_channels")
        .select("contact_id")
        .in("channel_id", channelIds)
        .in("contact_id", contactIds);
      const linkedSet = new Set((links ?? []).map((l) => l.contact_id));
      if (rule.operator === "not_equals") {
        return new Set(contactIds.filter((id) => !linkedSet.has(id)));
      }
      return linkedSet;
    }

    case "is_subscribed": {
      const { data } = await supabase
        .from("contacts")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("is_subscribed", rule.value === "true")
        .in("id", contactIds);
      return new Set((data ?? []).map((c) => c.id));
    }

    // Meta's follow-status API only ever confidently confirms a follow — it
    // never asserts "not a follower" — so the only meaningful check is
    // "confirmed follower" vs "not confirmed" (unchecked or unconfirmed).
    case "is_follower": {
      const { data } = await supabase
        .from("contacts")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("is_follower", rule.value === "true")
        .in("id", contactIds);
      return new Set((data ?? []).map((c) => c.id));
    }

    // Conversation started from an ad click (Meta click-to-DM referral).
    case "engaged_via_ad": {
      const { data } = await supabase
        .from("conversations")
        .select("contact_id")
        .eq("workspace_id", workspaceId)
        .eq("source->>kind", "ad")
        .in("contact_id", contactIds);
      const set = new Set((data ?? []).map((c) => c.contact_id));
      return rule.operator === "not_equals"
        ? new Set(contactIds.filter((id) => !set.has(id)))
        : set;
    }

    // Commented on a specific post (rule.value = the Late/Zernio post id).
    case "commented_on_post": {
      const { data: channels } = await supabase
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId);
      const channelIds = (channels ?? []).map((c) => c.id);
      if (!channelIds.length) return new Set();
      const { data: logs } = await supabase
        .from("comment_logs")
        .select("author_id, channel_id")
        .in("channel_id", channelIds)
        .eq("post_id", rule.value);
      return await matchCommentAuthors(supabase, logs ?? [], contactIds);
    }

    // Left a comment containing this text, on any post.
    case "commented_keyword": {
      const { data: channels } = await supabase
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId);
      const channelIds = (channels ?? []).map((c) => c.id);
      if (!channelIds.length) return new Set();
      const { data: logs } = await supabase
        .from("comment_logs")
        .select("author_id, channel_id")
        .in("channel_id", channelIds)
        .ilike("comment_text", `%${rule.value}%`);
      return await matchCommentAuthors(supabase, logs ?? [], contactIds);
    }

    case "last_interaction": {
      const date = new Date(rule.value).toISOString();
      let query = supabase
        .from("contacts")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("id", contactIds);
      query = rule.operator === "before" ? query.lt("last_interaction_at", date) : query.gt("last_interaction_at", date);
      const { data } = await query;
      return new Set((data ?? []).map((c) => c.id));
    }

    case "custom_field": {
      // The builder writes "<slug>::<value>" — split on the first "::" only,
      // so a value that itself contains "::" or ":" isn't mangled.
      const sep = rule.value.indexOf("::");
      const slug = sep === -1 ? rule.value : rule.value.slice(0, sep);
      const fieldValue = sep === -1 ? "" : rule.value.slice(sep + 2);

      const { data: fieldDef } = await supabase
        .from("custom_field_definitions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("slug", slug)
        .single();
      if (!fieldDef) return new Set();

      let cfQuery = supabase
        .from("contact_custom_fields")
        .select("contact_id")
        .eq("field_id", fieldDef.id)
        .in("contact_id", contactIds);

      switch (rule.operator) {
        case "equals":
          cfQuery = cfQuery.eq("value", fieldValue);
          break;
        case "not_equals":
          cfQuery = cfQuery.neq("value", fieldValue);
          break;
        case "contains":
          cfQuery = cfQuery.ilike("value", `%${fieldValue}%`);
          break;
        case "gt":
          cfQuery = cfQuery.gt("value", fieldValue);
          break;
        case "lt":
          cfQuery = cfQuery.lt("value", fieldValue);
          break;
      }

      const { data } = await cfQuery;
      return new Set((data ?? []).map((c) => c.contact_id));
    }

    default:
      return new Set(contactIds);
  }
}

/** Map comment_logs rows (author_id + channel_id) back to contact ids via
 * contact_channels (platform_sender_id + channel_id). */
async function matchCommentAuthors(
  supabase: SupabaseClient<Database>,
  logs: Array<{ author_id: string | null; channel_id: string }>,
  contactIds: string[]
): Promise<Set<string>> {
  const authorIds = [...new Set(logs.map((l) => l.author_id).filter(Boolean))] as string[];
  if (!authorIds.length) return new Set();
  const { data: links } = await supabase
    .from("contact_channels")
    .select("contact_id, platform_sender_id")
    .in("platform_sender_id", authorIds)
    .in("contact_id", contactIds);
  return new Set((links ?? []).map((l) => l.contact_id));
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set();
  const result = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    for (const item of result) {
      if (!sets[i].has(item)) result.delete(item);
    }
  }
  return result;
}

function unionSets(sets: Set<string>[]): Set<string> {
  const result = new Set<string>();
  for (const s of sets) {
    for (const item of s) result.add(item);
  }
  return result;
}
