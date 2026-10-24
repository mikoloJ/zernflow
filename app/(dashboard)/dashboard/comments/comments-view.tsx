"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Loader2, Send, CheckCircle2, AlertCircle } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { cn } from "@/lib/utils";

type Channel = {
  id: string;
  platform: string;
  username: string | null;
  display_name: string | null;
};

type CommentLog = {
  id: string;
  channel_id: string;
  post_id: string | null;
  author_name: string | null;
  author_username: string | null;
  comment_text: string;
  dm_sent: boolean;
  reply_sent: boolean;
  manual_reply_text: string | null;
  manual_replied_at: string | null;
  error: string | null;
  created_at: string;
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CommentsView({
  comments: initialComments,
  channels,
}: {
  comments: CommentLog[];
  channels: Channel[];
}) {
  const [comments, setComments] = useState(initialComments);
  const [platformFilter, setPlatformFilter] = useState<"all" | string>("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const platforms = useMemo(
    () => Array.from(new Set(channels.map((c) => c.platform))),
    [channels],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comments) {
      const platform = channelById.get(c.channel_id)?.platform ?? "unknown";
      m.set(platform, (m.get(platform) ?? 0) + 1);
    }
    return m;
  }, [comments, channelById]);

  const visibleComments = comments.filter((c) => {
    if (platformFilter === "all") return true;
    return channelById.get(c.channel_id)?.platform === platformFilter;
  });

  async function sendReply(commentId: string) {
    const text = (drafts[commentId] ?? "").trim();
    if (!text) return;
    setSendingId(commentId);
    setErrorById((prev) => ({ ...prev, [commentId]: "" }));
    try {
      const res = await fetch(`/api/v1/comments/${commentId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send reply");
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, reply_sent: true, manual_reply_text: text, manual_replied_at: data.repliedAt }
            : c,
        ),
      );
      setDrafts((prev) => ({ ...prev, [commentId]: "" }));
    } catch (err) {
      setErrorById((prev) => ({
        ...prev,
        [commentId]: err instanceof Error ? err.message : "Failed to send reply",
      }));
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold">Comments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every comment across your connected channels, in one place.
        </p>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-8 py-3">
        <button
          onClick={() => setPlatformFilter("all")}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            platformFilter === "all"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          All ({comments.length})
        </button>
        {platforms.map((platform) => (
          <button
            key={platform}
            onClick={() => setPlatformFilter(platform)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              platformFilter === platform
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            <PlatformIcon platform={platform} size={14} />
            {platform} ({counts.get(platform) ?? 0})
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {visibleComments.length === 0 ? (
          <div className="mx-auto max-w-md rounded-2xl border border-dashed border-border p-10 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">No comments here yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Comments on your connected posts will show up here as they come in.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-3">
            {visibleComments.map((c) => {
              const channel = channelById.get(c.channel_id);
              const sending = sendingId === c.id;
              const error = errorById[c.id];
              return (
                <div key={c.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      {channel && <PlatformIcon platform={channel.platform} size={16} />}
                      <span className="font-medium">
                        {c.author_name || c.author_username || "Unknown commenter"}
                      </span>
                      {c.author_username && c.author_name && (
                        <span className="text-xs text-muted-foreground">@{c.author_username}</span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(c.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{c.comment_text}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {c.reply_sent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Replied
                      </span>
                    )}
                    {c.dm_sent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                        DM sent
                      </span>
                    )}
                    {c.error && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        <AlertCircle className="h-3 w-3" />
                        {c.error}
                      </span>
                    )}
                  </div>

                  {c.manual_reply_text && (
                    <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Your reply: </span>
                      {c.manual_reply_text}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={drafts[c.id] ?? ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && sendReply(c.id)}
                      disabled={sending || !c.post_id}
                      placeholder={
                        c.post_id ? "Write a reply…" : "Can't reply — no post reference"
                      }
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
                    />
                    <button
                      onClick={() => sendReply(c.id)}
                      disabled={sending || !c.post_id || !(drafts[c.id] ?? "").trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {sending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      Reply
                    </button>
                  </div>
                  {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
