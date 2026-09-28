import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

interface IncomingMessage {
  text?: string;
  postbackPayload?: string;
  quickReplyPayload?: string;
  isStoryReply?: boolean;
  sender?: { id: string };
}

type Trigger = Database["public"]["Tables"]["triggers"]["Row"];

export async function matchTrigger(
  supabase: SupabaseClient<Database>,
  {
    channelId,
    workspaceId,
    conversationId,
    contactId,
    message,
    isFirstMessage,
  }: {
    channelId: string;
    workspaceId: string;
    conversationId: string;
    /** Needed for the "Default Reply" trigger's once-per-24h throttle. */
    contactId?: string;
    message: IncomingMessage;
    /** Caller-known "first inbound message" signal; inbound messages are not
     * mirrored locally, so the legacy count query below always sees 0. */
    isFirstMessage?: boolean;
  }
): Promise<Trigger | null> {
  // Triggers with null channel_id are workspace-wide, NOT global: the flows
  // join must be pinned to the channel's workspace or one tenant's triggers
  // (and flows) would run on another tenant's channels.
  const { data: triggers } = await supabase
    .from("triggers")
    .select("*, flows!inner(status, workspace_id)")
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .eq("is_active", true)
    .eq("flows.status", "published")
    .eq("flows.workspace_id", workspaceId)
    .order("priority", { ascending: false });

  if (!triggers || triggers.length === 0) return null;

  // Priority order: postback > quick_reply > keyword > welcome > default
  // 1. Check postback triggers
  if (message.postbackPayload) {
    const match = triggers.find(
      (t) =>
        t.type === "postback" &&
        (t.config as { payload?: string })?.payload === message.postbackPayload
    );
    if (match) return match;
  }

  // 2. Check quick_reply triggers
  if (message.quickReplyPayload) {
    const match = triggers.find(
      (t) =>
        t.type === "quick_reply" &&
        (t.config as { payload?: string })?.payload ===
          message.quickReplyPayload
    );
    if (match) return match;
  }

  // 3. Check keyword triggers
  if (message.text) {
    const text = message.text.toLowerCase().trim();

    for (const trigger of triggers.filter((t) => t.type === "keyword")) {
      const config = trigger.config as {
        keywords?: Array<string | { value: string; matchType?: "exact" | "contains" | "startsWith" }>;
        matchType?: "exact" | "contains" | "startsWith";
      };

      if (!config.keywords) continue;

      for (const kw of config.keywords) {
        // Support both formats: plain string or { value, matchType } object
        const keyword = (typeof kw === "string" ? kw : kw.value).toLowerCase();
        const matchType =
          (typeof kw === "object" && kw.matchType) || config.matchType || "contains";

        if (matchType === "exact" && text === keyword) return trigger;
        if (matchType === "contains" && text.includes(keyword)) return trigger;
        if (matchType === "startsWith" && text.startsWith(keyword))
          return trigger;
      }
    }
  }

  // 4. Check welcome trigger (first inbound message for this contact on this channel)
  let firstMessage = isFirstMessage;
  if (firstMessage === undefined) {
    const { count } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound");
    firstMessage = count === 1;
  }

  if (firstMessage) {
    const welcomeTrigger = triggers.find((t) => t.type === "welcome");
    if (welcomeTrigger) return welcomeTrigger;
  }

  // 5. Default trigger — ManyChat calls this "Default Reply": it fires when
  // nothing more specific matched. It supports two extra settings (config):
  //   - skipStoryReplies: ignore IG story replies/mentions entirely (free here,
  //     no plan-gating — this app has no paid tiers to gate it behind).
  //   - frequency: "once_per_24h" fires it at most once per contact per day,
  //     instead of on every single unmatched message ("every time").
  const defaultTrigger = triggers.find((t) => t.type === "default");
  if (!defaultTrigger) return null;

  const config = defaultTrigger.config as {
    skipStoryReplies?: boolean;
    frequency?: "always" | "once_per_24h";
  };

  if (config.skipStoryReplies && message.isStoryReply) return null;

  if (config.frequency === "once_per_24h" && contactId) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .eq("contact_id", contactId)
      .eq("event_type", "flow_started")
      .eq("metadata->>triggerId", defaultTrigger.id)
      .gte("created_at", since);
    if (count && count > 0) return null;
  }

  return defaultTrigger;
}
