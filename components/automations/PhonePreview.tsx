"use client";

import { Heart, MessageCircle, Send, Bookmark, Link2, ChevronLeft, Phone, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutomationConfig } from "@/lib/comment-automation-config";

export type PreviewTab = "post" | "comments" | "dm";

interface PhonePreviewProps {
  config: AutomationConfig;
  accountName: string;
  accountPicture?: string | null;
  tab: PreviewTab;
  onTabChange: (tab: PreviewTab) => void;
}

const SAMPLE = { first_name: "Ada", name: "Ada Obi", username: "ada.fit" };

function fill(text: string) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: keyof typeof SAMPLE) => SAMPLE[k] ?? "");
}

function Avatar({ src, name, size = 28 }: { src?: string | null; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-amber-400 text-[10px] font-semibold uppercase text-white"
      style={{ width: size, height: size }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

function DmButton({ label, link }: { label: string; link?: boolean }) {
  return (
    <div className="mt-1.5 flex items-center justify-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-center text-[12px] font-medium text-white">
      {label || "Button"}
      {link && <Link2 className="h-3 w-3 opacity-70" />}
    </div>
  );
}

export function PhonePreview({ config, accountName, accountPicture, tab, onTabChange }: PhonePreviewProps) {
  const post = config.postPreviews?.[0];
  const keyword = config.keywordMode === "any" ? "Love this! 😍" : config.keywords[0] || "PT";
  const reply = config.publicReply.enabled ? config.publicReply.replies.find((r) => r.trim()) : undefined;
  const linkButtons = config.linkDm.buttons.filter((b) => b.label.trim());

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[600px] w-[300px] rounded-[44px] bg-neutral-900 p-3 shadow-xl ring-1 ring-black/10">
        <div className="flex h-full flex-col overflow-hidden rounded-[34px] bg-black text-white">
          {/* status bar */}
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold">
            <span>9:41</span>
            <span className="h-4 w-20 rounded-full bg-neutral-800" />
            <span>●●●</span>
          </div>

          {tab === "dm" ? (
            <>
              <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                <ChevronLeft className="h-4 w-4" />
                <Avatar src={accountPicture} name={accountName} />
                <span className="flex-1 truncate text-[13px] font-semibold">{accountName}</span>
                <Phone className="h-4 w-4" />
                <Video className="h-4 w-4" />
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
                {config.openingDm.enabled ? (
                  <>
                    <Bubble>
                      <p className="whitespace-pre-wrap">{fill(config.openingDm.text) || "Your opening message…"}</p>
                      <DmButton label={config.openingDm.buttonLabel} />
                    </Bubble>
                    <div className="self-end rounded-2xl bg-violet-600 px-3 py-1.5 text-[12px]">
                      {config.openingDm.buttonLabel || "Button"}
                    </div>
                  </>
                ) : null}
                <Bubble>
                  <p className="whitespace-pre-wrap">{fill(config.linkDm.text) || "Your message with links…"}</p>
                  {linkButtons.map((b, i) => (
                    <DmButton key={i} label={b.label} link />
                  ))}
                </Bubble>
              </div>
              <div className="m-2 rounded-full bg-white/10 px-4 py-2 text-[12px] text-white/50">Message…</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2">
                <Avatar src={accountPicture} name={accountName} />
                <span className="text-[13px] font-semibold">{accountName}</span>
              </div>
              <div className="relative aspect-square w-full bg-neutral-800">
                {post?.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.picture} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-white/50">
                    {config.postMode === "any"
                      ? "Any of your posts or reels"
                      : config.postMode === "next"
                        ? "Your next post or reel"
                        : "Pick a post on the left"}
                  </div>
                )}
              </div>

              {tab === "post" ? (
                <div className="px-3 py-2 text-[12px]">
                  <div className="mb-2 flex gap-3">
                    <Heart className="h-5 w-5" />
                    <MessageCircle className="h-5 w-5" />
                    <Send className="h-5 w-5" />
                    <Bookmark className="ml-auto h-5 w-5" />
                  </div>
                  <p className="line-clamp-4">
                    <span className="font-semibold">{accountName}</span>{" "}
                    {post?.content || "Your caption…"}
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto px-3 py-3 text-[12px]">
                  <p className="mb-3 text-center text-[11px] font-semibold text-white/60">Comments</p>
                  <div className="flex gap-2">
                    <Avatar name={SAMPLE.username} size={26} />
                    <div>
                      <span className="font-semibold">{SAMPLE.username}</span> {keyword}
                      <p className="mt-0.5 text-[10px] text-white/40">1m · Reply</p>
                    </div>
                  </div>
                  {reply && (
                    <div className="ml-8 mt-3 flex gap-2">
                      <Avatar src={accountPicture} name={accountName} size={22} />
                      <div>
                        <span className="font-semibold">{accountName}</span>{" "}
                        <span className="text-sky-300">@{SAMPLE.username}</span> {fill(reply)}
                        <p className="mt-0.5 text-[10px] text-white/40">Just now · Reply</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-4 inline-flex rounded-full bg-muted p-1 text-sm">
        {(["post", "comments", "dm"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            className={cn(
              "rounded-full px-4 py-1.5 font-medium capitalize transition-colors",
              tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "dm" ? "DM" : t}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[88%] rounded-2xl bg-neutral-800 px-3 py-2 text-[12px] leading-snug">{children}</div>
  );
}
