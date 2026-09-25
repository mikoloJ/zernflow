"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Paperclip,
  Bot,
  MessageSquare,
  CheckCircle,
  Clock,
  RotateCcw,
  Loader2,
  Link2,
  FileText,
  Megaphone,
  ExternalLink,
  BadgeCheck,
  X,
  AlertCircle,
  Reply,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { Avatar } from "@/components/inbox/avatar";
import type { Database, ConversationStatus } from "@/lib/types/database";
import type { InboxAttachment, InboxMessage } from "@/lib/inbox-messages";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts: Database["public"]["Tables"]["contacts"]["Row"] | null;
};

interface Profile {
  name: string | null;
  username: string | null;
  picture: string | null;
  instagram: {
    followerCount: number | null;
    isVerified: boolean | null;
    isFollower: boolean | null;
    isFollowing: boolean | null;
  } | null;
  ad: {
    adId: string | null;
    title: string | null;
    headline: string | null;
    photoUrl: string | null;
    videoUrl: string | null;
    postId: string | null;
    postUrl: string | null;
    sourceUrl: string | null;
    source: string | null;
  } | null;
}

interface StoredSource {
  kind?: string;
  adId?: string | null;
  title?: string | null;
  photoUrl?: string | null;
  videoUrl?: string | null;
  postId?: string | null;
  sourceUrl?: string | null;
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function formatCount(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function Attachment({ a, outbound }: { a: InboxAttachment; outbound: boolean }) {
  const src = a.url ?? a.previewUrl ?? undefined;
  if (!src) return null;
  if (a.type === "image" || a.type === "sticker") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={a.filename ?? "Image"}
          referrerPolicy="no-referrer"
          onError={(e) => {
            const el = e.currentTarget;
            el.replaceWith(Object.assign(document.createElement("span"), {
              className: "inline-block rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground",
              textContent: "📷 Photo (link expired)",
            }));
          }}
          className={cn("max-h-72 rounded-xl object-cover", a.type === "sticker" ? "max-w-[140px]" : "max-w-[260px]")}
        />
      </a>
    );
  }
  if (a.type === "video") {
    return <video src={src} poster={a.previewUrl ?? undefined} controls className="max-h-72 max-w-[260px] rounded-xl" />;
  }
  if (a.type === "audio") {
    return <audio src={src} controls className="max-w-[260px]" />;
  }
  if (a.type === "share") {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "flex max-w-[260px] items-center gap-2 overflow-hidden rounded-xl border p-2 text-xs",
          outbound ? "border-white/30 bg-white/10" : "border-border bg-background",
        )}
      >
        {a.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.previewUrl} alt="" referrerPolicy="no-referrer" className="h-12 w-12 flex-shrink-0 rounded object-cover" />
        )}
        <span className="flex items-center gap-1 font-medium">
          <ExternalLink className="h-3 w-3" /> Shared post
        </span>
      </a>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-xs underline-offset-2 hover:underline", outbound ? "bg-white/15" : "bg-background")}
    >
      <FileText className="h-4 w-4" /> {a.filename ?? "Attachment"}
    </a>
  );
}

function MessageBubble({
  message,
  contactName,
  contactPicture,
  showAvatar,
  showStatus,
}: {
  message: InboxMessage;
  contactName: string;
  contactPicture: string | null;
  showAvatar: boolean;
  showStatus: boolean;
}) {
  const inbound = message.direction === "inbound";
  const x = message.extra;
  const attachments = x?.attachments ?? [];
  const buttons = x?.buttons ?? [];
  const quickReplies = x?.quickReplies ?? [];
  const hasText = !!message.text?.trim();
  const status = x?.deliveryStatus ?? (message.status === "failed" ? "failed" : message.status === "pending" ? null : "sent");
  const sender =
    x?.sentBy === "automation"
      ? `Automation${x.automationName ? ` · ${x.automationName}` : ""}`
      : x?.sentBy === "flow" || message.sent_by_flow_id
        ? "Flow"
        : x?.sentBy === "human" || message.sent_by_user_id
          ? "You"
          : null;

  return (
    <div className={cn("flex items-end gap-2", inbound ? "justify-start" : "justify-end")}>
      {inbound && (
        <div className="w-7 flex-shrink-0">
          {showAvatar && <Avatar src={contactPicture} name={contactName} className="h-7 w-7 text-xs" />}
        </div>
      )}

      <div className={cn("flex max-w-[72%] flex-col gap-1", inbound ? "items-start" : "items-end")}>
        {x?.storyReply && (
          <div className={cn("flex items-center gap-2 text-[11px] text-muted-foreground", !inbound && "flex-row-reverse")}>
            <Reply className="h-3 w-3" />
            {inbound ? "Replied to your story" : "You replied to their story"}
            {x.storyReply.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={x.storyReply.url} alt="" referrerPolicy="no-referrer" className="h-12 w-8 rounded object-cover" />
            )}
          </div>
        )}
        {x?.isStoryMention && <p className="text-[11px] text-muted-foreground">Mentioned you in their story</p>}

        {attachments.map((a, i) => (
          <Attachment key={i} a={a} outbound={!inbound} />
        ))}

        {(hasText || buttons.length > 0 || x?.isDeleted) && (
          <div
            className={cn(
              "overflow-hidden rounded-3xl text-sm",
              inbound
                ? "bg-[#EFEFEF] text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                : "bg-[#3797F0] text-white",
              message.status === "failed" && "opacity-70 ring-1 ring-red-400",
            )}
          >
            {x?.isDeleted ? (
              <p className="px-4 py-2 italic opacity-70">Message unsent</p>
            ) : (
              hasText && <p className="whitespace-pre-wrap break-words px-4 py-2">{message.text}</p>
            )}
            {buttons.length > 0 && (
              <div className={cn("flex flex-col gap-px", hasText && (inbound ? "border-t border-black/5" : "border-t border-white/20"))}>
                {buttons.map((b, i) =>
                  b.type === "url" && b.url ? (
                    <a
                      key={i}
                      href={b.url}
                      target="_blank"
                      rel="noreferrer"
                      title={b.url}
                      className={cn(
                        "flex items-center justify-center gap-1.5 px-4 py-2 text-center text-[13px] font-semibold hover:bg-black/5",
                        inbound ? "bg-white/60 dark:bg-neutral-700" : "bg-white/15",
                      )}
                    >
                      {b.title} <Link2 className="h-3 w-3 opacity-70" />
                    </a>
                  ) : (
                    <div
                      key={i}
                      className={cn(
                        "px-4 py-2 text-center text-[13px] font-semibold",
                        inbound ? "bg-white/60 dark:bg-neutral-700" : "bg-white/15",
                      )}
                    >
                      {b.title}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        )}

        {quickReplies.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {quickReplies.map((q, i) => (
              <span key={i} className="rounded-full border border-[#3797F0] px-3 py-1 text-xs font-medium text-[#3797F0]">
                {q}
              </span>
            ))}
          </div>
        )}

        {x?.reactions && x.reactions.length > 0 && (
          <div className="-mt-2 rounded-full border border-border bg-background px-1.5 text-xs shadow-sm">
            {x.reactions.map((r) => r.emoji).join(" ")}
          </div>
        )}

        <div className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          {!inbound && sender && (
            <span className="flex items-center gap-0.5">
              {sender !== "You" && <Bot className="h-3 w-3" />}
              {sender} ·
            </span>
          )}
          <span>{formatMessageTime(message.created_at)}</span>
          {x?.isEdited && <span>· Edited</span>}
          {!inbound && message.status === "pending" && <span>· Sending…</span>}
          {!inbound && showStatus && status === "read" && <span className="font-medium">· Seen</span>}
          {!inbound && showStatus && status === "delivered" && <span>· Delivered</span>}
          {!inbound && status === "failed" && (
            <span className="flex items-center gap-0.5 text-red-600" title={x?.deliveryError ?? undefined}>
              · <AlertCircle className="h-3 w-3" /> Not delivered{x?.deliveryError ? `: ${x.deliveryError}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AdBanner({ ad }: { ad: NonNullable<Profile["ad"]> }) {
  const link = ad.postUrl ?? ad.sourceUrl;
  return (
    <div className="mx-auto mb-6 flex max-w-md items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
      {ad.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.photoUrl} alt="" referrerPolicy="no-referrer" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
      ) : ad.videoUrl ? (
        <video src={ad.videoUrl} muted className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
          <Megaphone className="h-6 w-6 text-amber-700" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Started from an ad</p>
        <p className="truncate font-medium">{ad.title || ad.headline || "Meta ad"}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ad.adId ? `Ad ID ${ad.adId}` : ""}
          {ad.postId ? ` · Post ${ad.postId}` : ""}
        </p>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-800 underline dark:text-amber-300">
            {ad.postUrl ? "View the post" : "View the ad"} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export function MessageThread({
  conversation,
  messages: initialMessages,
}: {
  conversation: Conversation | null;
  messages: InboxMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<InboxMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; preview: string | null } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const contactName = profile?.name || conversation?.contacts?.display_name || "Unknown";
  const contactPicture = profile?.picture || conversation?.contacts?.avatar_url || null;
  const storedSource = (conversation as (Conversation & { source?: StoredSource | null }) | null)?.source;
  const ad: Profile["ad"] =
    profile?.ad ??
    (storedSource?.kind === "ad"
      ? {
          adId: storedSource.adId ?? null,
          title: storedSource.title ?? null,
          headline: null,
          photoUrl: storedSource.photoUrl ?? null,
          videoUrl: storedSource.videoUrl ?? null,
          postId: storedSource.postId ?? null,
          postUrl: storedSource.postId?.includes("_") ? `https://www.facebook.com/${storedSource.postId}` : null,
          sourceUrl: storedSource.sourceUrl ?? null,
          source: null,
        }
      : null);

  const updateConversationStatus = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation || statusUpdating) return;
      setStatusUpdating(status);
      try {
        const { error } = await createClient().from("conversations").update({ status }).eq("id", conversation.id);
        if (error) throw error;
        router.refresh();
      } catch {
        setSendError("Failed to update conversation status");
      } finally {
        setStatusUpdating(null);
      }
    },
    [conversation, statusUpdating, router],
  );

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Profile picture, Instagram stats and ad source for the header/banner.
  useEffect(() => {
    setProfile(null);
    if (!conversation) return;
    let cancelled = false;
    fetch(`/api/v1/conversations/${conversation.id}/profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!cancelled && p) setProfile(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation?.id]);

  // New activity on the conversation -> re-fetch messages from Zernio.
  useEffect(() => {
    if (!conversation) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`conversation-${conversation.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversation.id}` },
        async () => {
          try {
            const res = await fetch(`/api/v1/messages?conversationId=${conversation.id}`);
            if (res.ok) {
              const fresh: InboxMessage[] = await res.json();
              setMessages((prev) => [...fresh, ...prev.filter((m) => m.id.startsWith("optimistic-"))]);
            }
          } catch (err) {
            console.error("Failed to refresh messages:", err);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id]);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setSendError("Files must be under 25 MB.");
      return;
    }
    setPendingFile({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
  }

  async function uploadPending(): Promise<{ url: string; type: "image" | "video" | "audio" | "file" } | null> {
    if (!pendingFile || !conversation) return null;
    const supabase = createClient();
    const { file } = pendingFile;
    const safe = file.name.replace(/[^\w.-]+/g, "_");
    const path = `${conversation.workspace_id}/${conversation.id}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from("inbox-media").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    const { data } = supabase.storage.from("inbox-media").getPublicUrl(path);
    const type = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "file";
    return { url: data.publicUrl, type };
  }

  async function handleSend() {
    if ((!input.trim() && !pendingFile) || !conversation || sending) return;

    const text = input.trim();
    setInput("");
    setSending(true);
    setSendError(null);

    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: InboxMessage = {
      id: optimisticId,
      conversation_id: conversation.id,
      direction: "outbound",
      text: text || null,
      attachments: null,
      quick_reply_payload: null,
      postback_payload: null,
      callback_data: null,
      platform_message_id: null,
      sent_by_flow_id: null,
      sent_by_node_id: null,
      sent_by_user_id: "me",
      status: "pending",
      created_at: new Date().toISOString(),
      extra: {
        attachments: pendingFile?.preview ? [{ type: "image", url: pendingFile.preview }] : [],
        buttons: [],
        quickReplies: [],
        reactions: [],
        sentBy: "human",
      },
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const uploaded = await uploadPending();
      setPendingFile(null);
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          text,
          ...(uploaded ? { attachmentUrl: uploaded.url, attachmentType: uploaded.type } : {}),
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Send failed (${res.status})`);
      }
      const confirmed: InboxMessage = await res.json();
      setMessages((prev) => prev.map((m) => (m.id === optimisticId ? confirmed : m)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      setSendError(msg);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? { ...m, status: "failed" as const, extra: { ...m.extra!, deliveryStatus: "failed", deliveryError: msg } }
            : m,
        ),
      );
    } finally {
      setSending(false);
    }
  }

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">Select a conversation</h3>
        <p className="mt-1 text-xs text-muted-foreground/70">Choose a conversation from the list to view messages</p>
      </div>
    );
  }

  const lastOutboundId = [...messages].reverse().find((m) => m.direction === "outbound")?.id;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex-shrink-0">
            <Avatar src={contactPicture} name={contactName} className="h-10 w-10 text-sm" />
            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-background">
              <PlatformIcon platform={conversation.platform} className="h-2.5 w-2.5" size={10} />
            </div>
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-sm font-semibold">
              {contactName}
              {profile?.instagram?.isVerified && <BadgeCheck className="h-4 w-4 text-[#3797F0]" />}
              {ad && (
                <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  From ad
                </span>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[
                profile?.username ? `@${profile.username}` : null,
                profile?.instagram?.followerCount != null ? `${formatCount(profile.instagram.followerCount)} followers` : null,
                profile?.instagram?.isFollower ? "Follows you" : profile?.instagram?.isFollower === false ? "Doesn't follow you" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
              conversation.status === "open"
                ? "bg-green-100 text-green-700"
                : conversation.status === "snoozed"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {conversation.status}
          </span>
          {conversation.is_automation_paused && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">Bot paused</span>
          )}
          <div className="flex items-center gap-1">
            {conversation.status !== "closed" && (
              <button
                onClick={() => updateConversationStatus("closed")}
                disabled={!!statusUpdating}
                title="Close conversation"
                aria-label="Close conversation"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {statusUpdating === "closed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              </button>
            )}
            {conversation.status !== "snoozed" && (
              <button
                onClick={() => updateConversationStatus("snoozed")}
                disabled={!!statusUpdating}
                title="Snooze conversation"
                aria-label="Snooze conversation"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {statusUpdating === "snoozed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              </button>
            )}
            {conversation.status !== "open" && (
              <button
                onClick={() => updateConversationStatus("open")}
                disabled={!!statusUpdating}
                title="Reopen conversation"
                aria-label="Reopen conversation"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {statusUpdating === "open" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl">
          {ad && <AdBanner ad={ad} />}
          {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No messages in this conversation yet.</p>}
          {messages.map((message, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(message.created_at).toDateString();
            const groupedWithPrev = !!prev && !newDay && prev.direction === message.direction;
            const lastInGroup = !next || next.direction !== message.direction || new Date(next.created_at).toDateString() !== new Date(message.created_at).toDateString();
            return (
              <div key={message.id} className={groupedWithPrev ? "mt-1" : "mt-4"}>
                {newDay && (
                  <div className="my-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[11px] text-muted-foreground">{formatDateSeparator(message.created_at)}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <MessageBubble
                  message={message}
                  contactName={contactName}
                  contactPicture={contactPicture}
                  showAvatar={lastInGroup}
                  showStatus={message.id === lastOutboundId}
                />
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border p-4">
        <div className="mx-auto max-w-2xl">
          {sendError && (
            <div className="mb-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="flex-1">{sendError}</span>
              <button onClick={() => setSendError(null)} aria-label="Dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {pendingFile && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-1.5 pr-2 text-xs">
              {pendingFile.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pendingFile.preview} alt="" className="h-12 w-12 rounded object-cover" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
              <span className="max-w-[200px] truncate">{pendingFile.file.name}</span>
              <button onClick={() => setPendingFile(null)} aria-label="Remove attachment" className="rounded p-0.5 hover:bg-muted">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept="image/*,video/*,audio/*,application/pdf" className="hidden" onChange={pickFile} />
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a file"
              title="Attach image, video or file"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Message…"
                rows={1}
                className="w-full resize-none rounded-full border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                style={{ maxHeight: 150 }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={(!input.trim() && !pendingFile) || sending}
              aria-label="Send message"
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                (input.trim() || pendingFile) && !sending ? "bg-[#3797F0] text-white hover:opacity-90" : "bg-muted text-muted-foreground",
              )}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
