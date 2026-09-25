"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Link2, Loader2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/types/database";
import {
  splitKeywords,
  type AutomationConfig,
  type LinkButton,
} from "@/lib/comment-automation-config";
import { PostPicker } from "@/components/flow-builder/panels/PostPicker";
import { PhonePreview, type PreviewTab } from "./PhonePreview";

export interface EditorChannel {
  id: string;
  platform: string;
  username: string | null;
  display_name: string | null;
  profile_picture: string | null;
}

interface AutomationEditorProps {
  workspaceId: string;
  channels: EditorChannel[];
  initial: {
    id: string | null;
    name: string;
    channelId: string | null;
    isActive: boolean;
    config: AutomationConfig;
  };
}

const BUTTON_MAX = 20;

function channelLabel(c: EditorChannel) {
  const name = c.username ? `@${c.username}` : c.display_name || "Account";
  return `${name} · ${c.platform === "instagram" ? "Instagram" : "Facebook"}`;
}

export function AutomationEditor({ workspaceId, channels, initial }: AutomationEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [channelId, setChannelId] = useState(initial.channelId ?? channels[0]?.id ?? "");
  const [isActive, setIsActive] = useState(initial.isActive);
  const [config, setConfig] = useState<AutomationConfig>(initial.config);
  const [keywordInput, setKeywordInput] = useState(initial.config.keywords.join(", "));
  const [tab, setTab] = useState<PreviewTab>("post");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channel = channels.find((c) => c.id === channelId);
  const accountName = channel?.username || channel?.display_name || "your_account";

  const update = <K extends keyof AutomationConfig>(key: K, value: AutomationConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!channelId) p.push("Choose an account.");
    if (config.postMode === "specific" && config.postIds.length === 0) p.push("Pick at least one post.");
    if (config.keywordMode === "specific" && splitKeywords(keywordInput).length === 0)
      p.push("Add at least one keyword.");
    if (config.openingDm.enabled && !config.openingDm.text.trim()) p.push("Write the opening DM.");
    if (config.openingDm.enabled && !config.openingDm.buttonLabel.trim()) p.push("Give the opening DM a button label.");
    if (!config.linkDm.text.trim()) p.push("Write the DM with the link.");
    config.linkDm.buttons.forEach((b, i) => {
      if ((b.label.trim() || b.url.trim()) && !/^https?:\/\/\S+\.\S+/i.test(b.url.trim()))
        p.push(`Button ${i + 1} needs a full link starting with https://`);
      if (b.url.trim() && !b.label.trim()) p.push(`Button ${i + 1} needs a label.`);
    });
    return p;
  }, [channelId, config, keywordInput]);

  async function save() {
    if (problems.length) {
      setError(problems[0]);
      return;
    }
    setSaving(true);
    setError(null);

    const finalConfig: AutomationConfig = {
      ...config,
      keywords: config.keywordMode === "specific" ? splitKeywords(keywordInput) : [],
      publicReply: {
        ...config.publicReply,
        replies: config.publicReply.replies.map((r) => r.trim()).filter(Boolean),
      },
      linkDm: {
        ...config.linkDm,
        buttons: config.linkDm.buttons.filter((b) => b.label.trim() && b.url.trim()),
      },
    };
    if (finalConfig.postMode === "next") {
      finalConfig.nextAfter ??= new Date().toISOString();
    } else {
      delete finalConfig.nextAfter;
      delete finalConfig.lockedPostId;
    }
    if (finalConfig.postMode === "any") finalConfig.postIds = [];

    const supabase = createClient();
    const row = {
      workspace_id: workspaceId,
      channel_id: channelId,
      name: name.trim() || "Untitled automation",
      is_active: isActive,
      config: finalConfig as unknown as Json,
    };

    const result = initial.id
      ? await supabase.from("comment_automations").update(row).eq("id", initial.id).select("id").single()
      : await supabase.from("comment_automations").insert(row).select("id").single();

    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.push("/dashboard/automations");
    router.refresh();
  }

  async function remove() {
    if (!initial.id) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from("comment_automations").delete().eq("id", initial.id);
    router.push("/dashboard/automations");
    router.refresh();
  }

  const setReply = (i: number, value: string) =>
    update("publicReply", {
      ...config.publicReply,
      replies: config.publicReply.replies.map((r, j) => (j === i ? value : r)),
    });

  const setButton = (i: number, patch: Partial<LinkButton>) =>
    update("linkDm", {
      ...config.linkDm,
      buttons: config.linkDm.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <Link href="/dashboard/automations" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Automation name, e.g. PT course launch"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold hover:border-border focus:border-border focus:outline-none"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Toggle checked={isActive} onChange={setIsActive} />
          {isActive ? "Live" : "Paused"}
        </label>
        {initial.id && (
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted hover:text-red-600"
            aria-label="Delete automation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <Link href="/dashboard/automations" className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          Cancel
        </Link>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {initial.id ? "Update" : "Save & go live"}
        </button>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Form */}
        <div className="w-full overflow-y-auto border-border p-6 lg:w-[440px] lg:border-r">
          {channels.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Connect an Instagram or Facebook account in{" "}
              <Link href="/dashboard/settings" className="underline">Settings</Link> first.
            </p>
          ) : (
            <div className="space-y-7">
              <Section title="Account">
                <select
                  value={channelId}
                  onChange={(e) => {
                    setChannelId(e.target.value);
                    update("postIds", []);
                    update("postPreviews", []);
                  }}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>{channelLabel(c)}</option>
                  ))}
                </select>
              </Section>

              <Section title="When someone comments on" onFocus={() => setTab("post")}>
                <Choice
                  checked={config.postMode === "specific"}
                  onSelect={() => update("postMode", "specific")}
                  label="a specific post or reel"
                >
                  <PostPicker
                    gridOnly
                    channelId={channelId}
                    value={config.postIds}
                    onChange={(ids, posts) =>
                      setConfig((c) => ({
                        ...c,
                        postIds: ids,
                        postPreviews: ids.map(
                          (id) =>
                            posts.find((p) => p.id === id) ??
                            c.postPreviews?.find((p) => p.id === id) ?? { id, picture: null, content: "" },
                        ).map((p) => ({ id: p.id, picture: p.picture, content: p.content })),
                      }))
                    }
                  />
                </Choice>
                <Choice
                  checked={config.postMode === "any"}
                  onSelect={() => update("postMode", "any")}
                  label="any post or reel"
                  hint="Runs on every post, including future ones."
                />
                <Choice
                  checked={config.postMode === "next"}
                  onSelect={() => update("postMode", "next")}
                  label="next post or reel"
                  hint="Set it up now, then publish. It attaches to the next post you make."
                />
              </Section>

              <Section title="And this comment has" onFocus={() => setTab("comments")}>
                <Choice
                  checked={config.keywordMode === "specific"}
                  onSelect={() => update("keywordMode", "specific")}
                  label="a specific word or words"
                >
                  <input
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    placeholder="PT"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Use commas to separate words. Capitals don&apos;t matter, and &quot;PT please&quot; counts too.
                  </p>
                </Choice>
                <Choice
                  checked={config.keywordMode === "any"}
                  onSelect={() => update("keywordMode", "any")}
                  label="any word"
                />

                <div className="rounded-xl bg-muted/50 p-3">
                  <label className="flex cursor-pointer items-center justify-between text-sm">
                    reply to their comments under the post
                    <Toggle
                      checked={config.publicReply.enabled}
                      onChange={(v) => update("publicReply", { ...config.publicReply, enabled: v })}
                    />
                  </label>
                  {config.publicReply.enabled && (
                    <div className="mt-3 space-y-2">
                      {config.publicReply.replies.map((r, i) => (
                        <div key={i} className="flex gap-1.5">
                          <input
                            value={r}
                            onChange={(e) => setReply(i, e.target.value)}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                          />
                          <IconButton
                            label="Remove reply"
                            onClick={() =>
                              update("publicReply", {
                                ...config.publicReply,
                                replies: config.publicReply.replies.filter((_, j) => j !== i),
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          update("publicReply", { ...config.publicReply, replies: [...config.publicReply.replies, ""] })
                        }
                        className="flex items-center gap-1 text-xs font-medium text-primary"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add a variation
                      </button>
                      <p className="text-xs text-muted-foreground">One is picked at random each time, so replies don&apos;t look copy-pasted.</p>
                    </div>
                  )}
                </div>
              </Section>

              <Section title="They will get" onFocus={() => setTab("dm")}>
                <div className="rounded-xl bg-muted/50 p-3">
                  <label className="flex cursor-pointer items-center justify-between text-sm">
                    an opening DM
                    <Toggle
                      checked={config.openingDm.enabled}
                      onChange={(v) => update("openingDm", { ...config.openingDm, enabled: v })}
                    />
                  </label>
                  {config.openingDm.enabled ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={config.openingDm.text}
                        onChange={(e) => update("openingDm", { ...config.openingDm, text: e.target.value })}
                        rows={6}
                        maxLength={1000}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                      />
                      <CharCount value={config.openingDm.text} max={1000} />
                      <input
                        value={config.openingDm.buttonLabel}
                        onChange={(e) => update("openingDm", { ...config.openingDm, buttonLabel: e.target.value.slice(0, BUTTON_MAX) })}
                        placeholder="Button, e.g. I am ready!"
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        When they tap the button, the next DM with your links is sent. Tapping also opens a 24-hour window, so later messages can reach them.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Off: the DM with the links goes out straight away instead.
                    </p>
                  )}
                </div>
              </Section>

              <Section title={config.openingDm.enabled ? "And then, they will get" : "The DM"} onFocus={() => setTab("dm")}>
                <div className="rounded-xl bg-muted/50 p-3">
                  <p className="mb-2 text-sm">a DM with a link</p>
                  <textarea
                    value={config.linkDm.text}
                    onChange={(e) => update("linkDm", { ...config.linkDm, text: e.target.value })}
                    rows={4}
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  />
                  <CharCount value={config.linkDm.text} max={1000} />
                  <div className="mt-2 space-y-2">
                    {config.linkDm.buttons.map((b, i) => (
                      <div key={i} className="rounded-lg border border-border bg-card p-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            value={b.label}
                            onChange={(e) => setButton(i, { label: e.target.value.slice(0, BUTTON_MAX) })}
                            placeholder="Button label, e.g. Enrol Now"
                            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm focus:outline-none"
                          />
                          <Link2 className="h-3.5 w-3.5 text-primary" />
                          <IconButton
                            label="Remove button"
                            onClick={() =>
                              update("linkDm", { ...config.linkDm, buttons: config.linkDm.buttons.filter((_, j) => j !== i) })
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                        <input
                          value={b.url}
                          onChange={(e) => setButton(i, { url: e.target.value })}
                          placeholder="https://…"
                          className="mt-1 w-full rounded-md bg-muted px-2 py-1 text-xs focus:outline-none"
                        />
                      </div>
                    ))}
                    {config.linkDm.buttons.length < 3 && (
                      <button
                        type="button"
                        onClick={() => update("linkDm", { ...config.linkDm, buttons: [...config.linkDm.buttons, { label: "", url: "" }] })}
                        className="flex items-center gap-1 text-xs font-medium text-primary"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add a link button (max 3)
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Personalise with {"{{first_name}}"}, {"{{username}}"} or {"{{comment}}"}.
                </p>
              </Section>

              {problems.length > 0 && (
                <ul className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  {problems.map((p) => (
                    <li key={p}>• {p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="flex flex-1 items-start justify-center overflow-y-auto bg-muted/40 p-8">
          <PhonePreview
            config={{ ...config, keywords: splitKeywords(keywordInput) }}
            accountName={accountName}
            accountPicture={channel?.profile_picture}
            tab={tab}
            onTabChange={setTab}
          />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, onFocus }: { title: string; children: React.ReactNode; onFocus?: () => void }) {
  return (
    <section onFocusCapture={onFocus} onClickCapture={onFocus} className="space-y-2.5">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Choice({
  checked,
  onSelect,
  label,
  hint,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl p-3 transition-colors", checked ? "bg-muted/70 ring-1 ring-primary/40" : "bg-muted/40")}>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input type="radio" checked={checked} onChange={onSelect} className="h-4 w-4 accent-primary" />
        {label}
      </label>
      {hint && checked && <p className="ml-6 mt-1 text-xs text-muted-foreground">{hint}</p>}
      {checked && children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted-foreground/30")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="rounded p-1 text-muted-foreground hover:bg-muted">
      {children}
    </button>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  return <p className="text-right text-[11px] text-muted-foreground">{max - value.length}</p>;
}

