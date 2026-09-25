import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import { messagePreview } from "@/lib/message-preview";
import {
  fillAutomationTemplates,
  enrichWithAutomations,
  enrichWithLocal,
  mapZernioMessage,
  sortChronologically,
} from "@/lib/inbox-messages";
import { parseConfig } from "@/lib/comment-automation-config";

/**
 * GET /api/v1/messages?conversationId=...
 *
 * Fetches messages from the Zernio API (source of truth) instead of a local mirror.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }

  // Look up the Zernio conversation ID and workspace API key
  const { data: conversation } = await supabase
    .from("conversations")
    .select("late_conversation_id, workspace_id, contact_id, channel_id, channels(late_account_id)")
    .eq("id", conversationId)
    .single();

  if (!conversation?.late_conversation_id) {
    return NextResponse.json({ error: "Conversation not found or missing Zernio ID" }, { status: 404 });
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", conversation.workspace_id)
    .single();

  if (!workspace?.late_api_key_encrypted) {
    return NextResponse.json({ error: "API key not configured" }, { status: 400 });
  }

  const channel = conversation.channels as { late_account_id: string } | null;
  if (!channel?.late_account_id) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Fetch messages from Zernio API (paged), then enrich them with what we
  // know about our own sends (buttons, which automation/flow sent them).
  try {
    const zernio = createZernioClient(workspace.late_api_key_encrypted);
    const raw: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page++) {
      const res = await zernio.messages.getInboxConversationMessages({
        path: { conversationId: conversation.late_conversation_id },
        query: { accountId: channel.late_account_id, limit: 100, sortOrder: "desc", ...(cursor ? { cursor } : {}) },
      });
      const body = res.data as { messages?: unknown[]; data?: unknown[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } } | undefined;
      raw.push(...(body?.messages ?? body?.data ?? []));
      if (!body?.pagination?.hasMore || !body.pagination.nextCursor) break;
      cursor = body.pagination.nextCursor;
    }

    let messages = raw.map((m) => mapZernioMessage(m, conversationId));

    // ?debug=1 shows what the platform returned for messages we can't render.
    if (request.nextUrl.searchParams.get("debug") === "1") {
      return NextResponse.json(raw.filter((_, i) => messages[i].extra?.unsupported).slice(0, 5));
    }

    const { data: senderLink } = await supabase
      .from("contact_channels")
      .select("platform_sender_id")
      .eq("contact_id", conversation.contact_id)
      .eq("channel_id", conversation.channel_id)
      .maybeSingle();

    const [{ data: local }, { data: automations }, { data: runs }] = await Promise.all([
      supabase
        .from("messages")
        .select("text, attachments, created_at, sent_by_flow_id, sent_by_user_id")
        .eq("conversation_id", conversationId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("comment_automations")
        .select("id, name, config")
        .eq("workspace_id", conversation.workspace_id),
      senderLink?.platform_sender_id
        ? supabase
            .from("comment_logs")
            .select("created_at, matched_automation_id, author_name, author_username, comment_text")
            .eq("channel_id", conversation.channel_id)
            .eq("author_id", senderLink.platform_sender_id)
            .eq("dm_sent", true)
            .not("matched_automation_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as never[] }),
    ]);

    const templates = new Map(
      (automations ?? []).map((a) => {
        const c = parseConfig(a.config);
        return [
          a.id,
          {
            name: a.name,
            openingText: c.openingDm.enabled ? c.openingDm.text : null,
            openingButton: c.openingDm.enabled ? c.openingDm.buttonLabel : null,
            linkText: c.linkDm.text,
            linkButtons: c.linkDm.buttons,
          },
        ] as const;
      }),
    );

    messages = enrichWithLocal(messages, local ?? []);
    messages = enrichWithAutomations(messages, [...templates.values()]);
    messages = fillAutomationTemplates(
      messages,
      (runs ?? []).flatMap((r) => {
        const template = r.matched_automation_id ? templates.get(r.matched_automation_id) : undefined;
        if (!template) return [];
        const name = r.author_name || r.author_username || "";
        return [
          {
            at: r.created_at,
            template,
            vars: {
              first_name: name.split(/\s+/)[0] || "there",
              name,
              username: r.author_username || "",
              comment: r.comment_text,
            },
          },
        ];
      }),
    );

    return NextResponse.json(sortChronologically(messages));
  } catch (error) {
    console.error("Failed to fetch messages from Zernio API:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/messages
 *
 * Sends a message via Zernio API. No local message storage — Zernio is the source of truth.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { conversationId } = body;
  const text: string = typeof body.text === "string" ? body.text : "";
  const attachmentUrl: string | undefined =
    typeof body.attachmentUrl === "string" && /^https?:\/\//.test(body.attachmentUrl) ? body.attachmentUrl : undefined;
  const attachmentType: "image" | "video" | "audio" | "file" | undefined = ["image", "video", "audio", "file"].includes(
    body.attachmentType,
  )
    ? body.attachmentType
    : attachmentUrl
      ? "file"
      : undefined;

  if (!conversationId || (!text.trim() && !attachmentUrl)) {
    return NextResponse.json(
      { error: "conversationId and text or an attachment required" },
      { status: 400 }
    );
  }

  // Get conversation with channel info
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*, channels(*)")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (!conversation.late_conversation_id) {
    return NextResponse.json(
      { error: "No Zernio conversation ID linked to this conversation" },
      { status: 400 }
    );
  }

  const channel = conversation.channels as { late_account_id: string } | null;
  if (!channel?.late_account_id) {
    return NextResponse.json({ error: "Channel not found or missing Zernio account ID" }, { status: 404 });
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", conversation.workspace_id)
    .single();

  if (!workspace?.late_api_key_encrypted) {
    return NextResponse.json({ error: "API key not configured" }, { status: 400 });
  }

  // Send via Zernio SDK — Zernio stores the message, no local insert needed
  try {
    const zernio = createZernioClient(workspace.late_api_key_encrypted);
    const res = await zernio.messages.sendInboxMessage({
      path: { conversationId: conversation.late_conversation_id },
      body: {
        accountId: channel.late_account_id,
        ...(text.trim() ? { message: text } : {}),
        ...(attachmentUrl ? { attachmentUrl, attachmentType } : {}),
      },
    });

    if (res.error) {
      const e = res.error as { error?: string; message?: string };
      const reason = e?.error || e?.message || "The platform rejected the message";
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messageId = (res.data as any)?.data?.messageId ?? null;
    const attachments = attachmentUrl ? [{ type: attachmentType, url: attachmentUrl }] : null;

    // Keep our own record so the inbox can show this was sent by a person.
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      text: text || null,
      attachments,
      sent_by_user_id: user.id,
      platform_message_id: messageId,
      status: "sent",
    });

    // Update conversation's last message info (ZernFlow-specific metadata)
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: messagePreview(text || (attachmentType === "image" ? "📷 Photo" : "📎 Attachment")),
      })
      .eq("id", conversationId);

    // Return a message-shaped response for the UI's optimistic update
    return NextResponse.json(
      {
        id: messageId ?? `sent-${Date.now()}`,
        conversation_id: conversationId,
        direction: "outbound",
        text: text || null,
        attachments,
        quick_reply_payload: null,
        postback_payload: null,
        callback_data: null,
        platform_message_id: messageId,
        sent_by_flow_id: null,
        sent_by_node_id: null,
        sent_by_user_id: user.id,
        status: "sent",
        created_at: new Date().toISOString(),
        extra: {
          attachments: attachments ?? [],
          buttons: [],
          quickReplies: [],
          reactions: [],
          deliveryStatus: "sent",
          sentBy: "human",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to send message via Zernio API:", error);
    return NextResponse.json(
      { error: `Failed to send message: ${error}` },
      { status: 500 }
    );
  }
}
