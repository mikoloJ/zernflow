/**
 * Turns Zernio inbox messages into the rich shape the inbox renders:
 * direction, text, media attachments, buttons/quick replies we sent, story
 * replies, delivery status, reactions, edits and unsends.
 */

import type { Json } from "@/lib/types/database";

export interface InboxButton {
  title: string;
  type: "url" | "postback" | "phone";
  url?: string;
}

export interface InboxAttachment {
  type: "image" | "video" | "audio" | "file" | "sticker" | "share" | string;
  url?: string;
  previewUrl?: string | null;
  filename?: string | null;
}

export interface InboxMessageExtra {
  attachments: InboxAttachment[];
  buttons: InboxButton[];
  quickReplies: string[];
  storyReply?: { url?: string | null } | null;
  isStoryMention?: boolean;
  isDeleted?: boolean;
  isEdited?: boolean;
  deliveryStatus?: "sent" | "delivered" | "read" | "failed" | "deleted" | null;
  deliveryError?: string | null;
  reactions: Array<{ emoji: string; fromMe: boolean }>;
  /** Who sent an outbound message: an automation/flow, or a person. */
  sentBy?: "automation" | "flow" | "human" | null;
  automationName?: string | null;
  /** The platform returned nothing we can show (e.g. a card/template sent by another tool). */
  unsupported?: boolean;
}

/** The DB `messages` row shape the inbox already uses, plus rich extras. */
export interface InboxMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  attachments: Json | null;
  quick_reply_payload: string | null;
  postback_payload: string | null;
  callback_data: string | null;
  platform_message_id: string | null;
  sent_by_flow_id: string | null;
  sent_by_node_id: string | null;
  sent_by_user_id: string | null;
  status: "pending" | "sent" | "delivered" | "failed";
  created_at: string;
  extra?: InboxMessageExtra;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapZernioMessage(m: any, conversationId: string): InboxMessage {
  const outbound = m.direction === "outgoing" || m.direction === "outbound";
  const attachments: InboxAttachment[] = Array.isArray(m.attachments)
    ? m.attachments
        .filter((a: any) => a && (a.url || a.previewUrl || a.type))
        .map((a: any) => ({
          type: a.type ?? "file",
          url: a.url ?? undefined,
          previewUrl: a.previewUrl ?? null,
          filename: a.filename ?? null,
        }))
    : [];

  const meta = (m.metadata ?? {}) as Record<string, any>;
  // WhatsApp interactive messages carry a compact descriptor of what was sent.
  const wa = meta.waInteractive as any;
  const buttons: InboxButton[] = Array.isArray(wa?.buttons)
    ? wa.buttons.map((b: any) => ({ title: String(b.title ?? b.text ?? ""), type: b.url ? "url" : "postback", url: b.url }))
    : wa?.type === "cta_url" && wa?.url
      ? [{ title: String(wa.displayText ?? wa.title ?? "Open link"), type: "url", url: wa.url }]
      : [];

  const deliveryStatus = (m.deliveryStatus ?? null) as InboxMessageExtra["deliveryStatus"];
  const text: string | null = m.message ?? m.text ?? null;
  const unsupported =
    !text?.trim() && attachments.length === 0 && buttons.length === 0 && !m.storyReply && !m.isStoryMention && !m.isDeleted;
  return {
    id: String(m.id),
    conversation_id: conversationId,
    direction: outbound ? "outbound" : "inbound",
    text,
    attachments: null,
    quick_reply_payload: null,
    postback_payload: null,
    callback_data: null,
    platform_message_id: m.platformMessageId ?? null,
    sent_by_flow_id: null,
    sent_by_node_id: null,
    sent_by_user_id: null,
    status: deliveryStatus === "failed" ? "failed" : deliveryStatus === "delivered" || deliveryStatus === "read" ? "delivered" : "sent",
    created_at: m.createdAt ?? m.sentAt ?? new Date().toISOString(),
    extra: {
      attachments,
      buttons,
      quickReplies: [],
      storyReply: m.storyReply ? { url: typeof m.storyReply === "object" ? m.storyReply.storyUrl ?? null : null } : null,
      isStoryMention: !!m.isStoryMention,
      isDeleted: !!m.isDeleted,
      isEdited: !!m.isEdited,
      deliveryStatus,
      deliveryError: m.deliveryError?.message ?? m.deliveryError?.title ?? null,
      reactions: Array.isArray(m.reactions)
        ? m.reactions.filter((r: any) => r?.emoji).map((r: any) => ({ emoji: r.emoji, fromMe: !!r.fromMe }))
        : [],
      sentBy: null,
      unsupported,
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export interface LocalOutbound {
  text: string | null;
  attachments: Json | null;
  created_at: string;
  sent_by_flow_id: string | null;
  sent_by_user_id: string | null;
}

/** Buttons/quick replies we stored locally when sending, as [{type:'buttons',...}] attachment entries. */
function localRich(attachments: Json | null) {
  const list = Array.isArray(attachments) ? (attachments as Array<Record<string, unknown>>) : [];
  const buttons: InboxButton[] = [];
  const quickReplies: string[] = [];
  for (const a of list) {
    if (a?.type === "buttons" && Array.isArray(a.buttons)) {
      for (const b of a.buttons as Array<Record<string, unknown>>) {
        buttons.push({ title: String(b.title ?? ""), type: (b.type as InboxButton["type"]) ?? "postback", url: b.url as string | undefined });
      }
    }
    if (a?.type === "quick_replies" && Array.isArray(a.items)) {
      for (const q of a.items as Array<Record<string, unknown>>) quickReplies.push(String(q.title ?? ""));
    }
  }
  return { buttons, quickReplies };
}

/**
 * Zernio doesn't echo the buttons we sent, so attach them from our own record
 * of the send: same text, outbound, within a few minutes.
 */
export function enrichWithLocal(messages: InboxMessage[], local: LocalOutbound[]): InboxMessage[] {
  const WINDOW = 5 * 60 * 1000;
  const used = new Set<number>();
  return messages.map((m) => {
    if (m.direction !== "outbound" || !m.extra) return m;
    const t = new Date(m.created_at).getTime();
    const idx = local.findIndex(
      (l, i) =>
        !used.has(i) &&
        norm(l.text) === norm(m.text) &&
        Math.abs(new Date(l.created_at).getTime() - t) <= WINDOW,
    );
    if (idx === -1) return m;
    used.add(idx);
    const l = local[idx];
    const rich = localRich(l.attachments);
    return {
      ...m,
      sent_by_flow_id: l.sent_by_flow_id,
      sent_by_user_id: l.sent_by_user_id,
      extra: {
        ...m.extra,
        buttons: m.extra.buttons.length ? m.extra.buttons : rich.buttons,
        quickReplies: rich.quickReplies,
        sentBy: m.extra.sentBy ?? (l.sent_by_flow_id ? "flow" : l.sent_by_user_id ? "human" : null),
      },
    };
  });
}

export interface AutomationTemplate {
  name: string;
  openingText: string | null;
  openingButton: string | null;
  linkText: string;
  linkButtons: Array<{ label: string; url: string }>;
}

/** "Hey {{first_name}}! ..." -> regex that matches any personalisation. */
export function templateRegex(template: string): RegExp {
  const parts = template.split(/\{\{\s*\w+\s*\}\}/g).map((p) => norm(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join(".*?")}$`, "s");
}

/** Recognise messages our comment automations sent and show their buttons. */
export function enrichWithAutomations(messages: InboxMessage[], automations: AutomationTemplate[]): InboxMessage[] {
  if (!automations.length) return messages;
  const compiled = automations.map((a) => ({
    a,
    opening: a.openingText ? templateRegex(a.openingText) : null,
    link: a.linkText ? templateRegex(a.linkText) : null,
  }));
  return messages.map((m) => {
    if (m.direction !== "outbound" || !m.extra || m.extra.buttons.length) return m;
    const text = norm(m.text);
    for (const { a, opening, link } of compiled) {
      if (opening?.test(text)) {
        return {
          ...m,
          extra: {
            ...m.extra,
            buttons: a.openingButton ? [{ title: a.openingButton, type: "postback" }] : [],
            sentBy: "automation",
            automationName: a.name,
          },
        };
      }
      if (link?.test(text)) {
        return {
          ...m,
          extra: {
            ...m.extra,
            buttons: a.linkButtons.filter((b) => b.label && b.url).map((b) => ({ title: b.label, type: "url" as const, url: b.url })),
            sentBy: "automation",
            automationName: a.name,
          },
        };
      }
    }
    return m;
  });
}

export function sortChronologically(messages: InboxMessage[]): InboxMessage[] {
  return [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}
