"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface PickerPost {
  id: string;
  platform: string;
  channelId: string;
  channelName: string;
  content: string;
  picture: string | null;
  permalink: string | null;
  createdTime: string | null;
  commentCount: number;
}

interface PostPickerProps {
  /** Selected post IDs. Empty means "all posts". */
  value: string[];
  onChange: (postIds: string[]) => void;
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Lets the user scope a comment trigger to all posts or to specific posts,
 * chosen visually from their recent Instagram/Facebook posts.
 */
export function PostPicker({ value, onChange }: PostPickerProps) {
  const [mode, setMode] = useState<"all" | "specific">(value.length ? "specific" : "all");
  const [posts, setPosts] = useState<PickerPost[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/posts");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load posts");
      setPosts(body.posts ?? []);
      if (body.failed?.length) {
        setError(`Couldn't load posts for: ${body.failed.join(", ")}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "specific" && posts === null && !loading) load();
  }, [mode, posts, loading, load]);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const selectMode = (next: "all" | "specific") => {
    setMode(next);
    if (next === "all") onChange([]);
  };

  const knownIds = new Set((posts ?? []).map((p) => p.id));
  const hiddenSelected = value.filter((id) => !knownIds.has(id));

  return (
    <div>
      <label className="mb-2 block text-xs font-semibold text-foreground">
        Which posts?
      </label>

      <div className="grid grid-cols-2 gap-2">
        {(["all", "specific"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => selectMode(m)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              mode === m
                ? "border-emerald-500 bg-emerald-50 font-medium text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-input",
            )}
          >
            {m === "all" ? "All posts" : "Specific posts"}
          </button>
        ))}
      </div>

      {mode === "all" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Runs on comments on every post and reel, including future ones.
        </p>
      )}

      {mode === "specific" && (
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {value.length
                ? `${value.length} post${value.length === 1 ? "" : "s"} selected`
                : "Tap the posts this should run on."}
            </p>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              Refresh
            </button>
          </div>

          {error && (
            <p className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              {error}
            </p>
          )}

          {loading && posts === null && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your posts…
            </div>
          )}

          {posts !== null && posts.length === 0 && !loading && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No posts found. Connect an Instagram or Facebook account in Settings.
            </p>
          )}

          {posts !== null && posts.length > 0 && (
            <div className="grid max-h-80 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
              {posts.map((post) => {
                const selected = value.includes(post.id);
                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => toggle(post.id)}
                    title={post.content || "Post"}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-md border-2 bg-muted text-left",
                      selected ? "border-emerald-500" : "border-transparent hover:border-input",
                    )}
                  >
                    {post.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.picture}
                        alt=""
                        loading="lazy"
                        className={cn("h-full w-full object-cover", selected && "opacity-80")}
                      />
                    ) : (
                      <span className="line-clamp-4 block p-1.5 text-[10px] leading-tight text-muted-foreground">
                        {post.content || "Text post"}
                      </span>
                    )}

                    {selected && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    )}

                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-3 text-[9px] text-white">
                      <span>{formatDate(post.createdTime)}</span>
                      <span className="flex items-center gap-0.5">
                        <MessageCircle className="h-2.5 w-2.5" />
                        {post.commentCount}
                      </span>
                    </span>

                    {post.permalink && (
                      <a
                        href={post.permalink}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="absolute left-1 top-1 hidden rounded bg-black/60 p-0.5 text-white group-hover:block"
                        aria-label="Open post"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {posts !== null && hiddenSelected.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Plus {hiddenSelected.length} older post
              {hiddenSelected.length === 1 ? "" : "s"} not shown.{" "}
              <button
                type="button"
                onClick={() => onChange(value.filter((id) => knownIds.has(id)))}
                className="underline hover:text-foreground"
              >
                Remove
              </button>
            </p>
          )}

          {mode === "specific" && value.length === 0 && posts !== null && posts.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              Nothing selected yet, so this still runs on all posts.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
