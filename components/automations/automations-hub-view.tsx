"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Folder,
  FolderPlus,
  GitBranch,
  MessageCircleReply,
  Plus,
  Sparkles,
  ChevronDown,
  Loader2,
  Pencil,
  Trash2,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { FlowStatus } from "@/lib/types/database";

type FlowRow = {
  id: string;
  name: string;
  status: FlowStatus;
  folder_id: string | null;
  updated_at: string;
  nodes: unknown;
};

type CommentAutomationRow = {
  id: string;
  name: string;
  is_active: boolean;
  channel_id: string | null;
  folder_id: string | null;
  updated_at: string;
  comments_matched: number;
  opening_dms_sent: number;
  link_dms_sent: number;
  button_taps: number;
};

type Folder_ = { id: string; name: string; created_at: string };
type Channel = { id: string; platform: string; username: string | null; display_name: string | null };
type Trigger = { flow_id: string; channel_id: string | null; type: string };

type StatusKind = "live" | "draft" | "archived" | "paused";

interface HubItem {
  id: string;
  kind: "flow" | "comment";
  name: string;
  status: StatusKind;
  folderId: string | null;
  updatedAt: string;
  platforms: string[];
  stat: string;
  href: string;
}

const statusConfig: Record<StatusKind, { label: string; classes: string }> = {
  live: {
    label: "Live",
    classes: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  draft: { label: "Draft", classes: "bg-muted text-muted-foreground" },
  archived: {
    label: "Archived",
    classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
  paused: { label: "Paused", classes: "bg-muted text-muted-foreground" },
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AutomationsHubView({
  workspaceId,
  flows,
  commentAutomations,
  folders: initialFolders,
  channels,
  triggers,
}: {
  workspaceId: string;
  flows: FlowRow[];
  commentAutomations: CommentAutomationRow[];
  folders: Folder_[];
  channels: Channel[];
  triggers: Trigger[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [folders, setFolders] = useState(initialFolders);
  const [activeFolder, setActiveFolder] = useState<"all" | "unfiled" | string>("all");
  const [creatingFlow, setCreatingFlow] = useState(false);
  const [newAutomationOpen, setNewAutomationOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename"; folder?: Folder_ } | null>(null);
  const [folderNameInput, setFolderNameInput] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<Folder_ | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const flowPlatforms = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const t of triggers) {
      if (!t.channel_id) continue;
      const channel = channelById.get(t.channel_id);
      if (!channel) continue;
      if (!map.has(t.flow_id)) map.set(t.flow_id, new Set());
      map.get(t.flow_id)!.add(channel.platform);
    }
    return map;
  }, [triggers, channelById]);

  const items: HubItem[] = useMemo(() => {
    const flowItems: HubItem[] = flows.map((f) => ({
      id: f.id,
      kind: "flow",
      name: f.name,
      status: f.status === "published" ? "live" : f.status === "archived" ? "archived" : "draft",
      folderId: f.folder_id,
      updatedAt: f.updated_at,
      platforms: Array.from(flowPlatforms.get(f.id) ?? []),
      stat: `${Array.isArray(f.nodes) ? f.nodes.length : 0} nodes`,
      href: `/dashboard/flows/${f.id}`,
    }));

    const commentItems: HubItem[] = commentAutomations.map((a) => {
      const channel = a.channel_id ? channelById.get(a.channel_id) : null;
      return {
        id: a.id,
        kind: "comment",
        name: a.name,
        status: a.is_active ? "live" : "paused",
        folderId: a.folder_id,
        updatedAt: a.updated_at,
        platforms: channel ? [channel.platform] : [],
        stat: `${a.comments_matched} comments · ${a.opening_dms_sent + a.link_dms_sent} DMs · ${a.button_taps} taps`,
        href: `/dashboard/automations/${a.id}`,
      };
    });

    return [...flowItems, ...commentItems].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [flows, commentAutomations, flowPlatforms, channelById]);

  const visibleItems = items.filter((item) => {
    if (activeFolder === "all") return true;
    if (activeFolder === "unfiled") return !item.folderId;
    return item.folderId === activeFolder;
  });

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.folderId) continue;
      counts.set(item.folderId, (counts.get(item.folderId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const unfiledCount = items.filter((i) => !i.folderId).length;

  async function handleSaveFolder() {
    const name = folderNameInput.trim();
    if (!name || !folderDialog) return;
    setSavingFolder(true);
    try {
      if (folderDialog.mode === "create") {
        const { data, error } = await supabase
          .from("automation_folders")
          .insert({ workspace_id: workspaceId, name })
          .select("id, name, created_at")
          .single();
        if (!error && data) {
          setFolders((prev) => [...prev, data]);
        }
      } else if (folderDialog.folder) {
        const { error } = await supabase
          .from("automation_folders")
          .update({ name })
          .eq("id", folderDialog.folder.id);
        if (!error) {
          setFolders((prev) => prev.map((f) => (f.id === folderDialog.folder!.id ? { ...f, name } : f)));
        }
      }
    } finally {
      setSavingFolder(false);
      setFolderDialog(null);
      setFolderNameInput("");
    }
  }

  async function handleDeleteFolder() {
    if (!deleteFolderTarget) return;
    const id = deleteFolderTarget.id;
    setDeleteFolderTarget(null);
    await supabase.from("automation_folders").delete().eq("id", id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    if (activeFolder === id) setActiveFolder("all");
    router.refresh();
  }

  async function handleMoveToFolder(item: HubItem, folderId: string | null) {
    setBusyItemId(item.id);
    try {
      const table = item.kind === "flow" ? "flows" : "comment_automations";
      await supabase.from(table).update({ folder_id: folderId }).eq("id", item.id);
      router.refresh();
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleCreateFlow() {
    if (creatingFlow) return;
    setCreatingFlow(true);
    try {
      const res = await fetch("/api/v1/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled Flow" }),
      });
      if (!res.ok) throw new Error("Failed to create flow");
      const flow = await res.json();
      router.push(`/dashboard/flows/${flow.id}`);
    } catch (err) {
      console.error("Failed to create flow:", err);
      alert("Failed to create flow. Please try again.");
    } finally {
      setCreatingFlow(false);
      setNewAutomationOpen(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* Folder sidebar */}
      <div className="w-56 shrink-0 border-r border-border p-4">
        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          My Automations
        </p>
        <div className="mt-2 space-y-0.5">
          <button
            onClick={() => setActiveFolder("all")}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors",
              activeFolder === "all" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            <span>All automations</span>
            <span className="text-xs">{items.length}</span>
          </button>
          <button
            onClick={() => setActiveFolder("unfiled")}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors",
              activeFolder === "unfiled" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            <span>Unfiled</span>
            <span className="text-xs">{unfiledCount}</span>
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between px-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Folders</p>
          <button
            onClick={() => {
              setFolderDialog({ mode: "create" });
              setFolderNameInput("");
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1 space-y-0.5">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className={cn(
                "group flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors",
                activeFolder === folder.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              <button
                onClick={() => setActiveFolder(folder.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
              <div className="hidden items-center gap-1 group-hover:flex">
                <button
                  onClick={() => {
                    setFolderDialog({ mode: "rename", folder });
                    setFolderNameInput(folder.name);
                  }}
                  aria-label={`Rename ${folder.name}`}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button onClick={() => setDeleteFolderTarget(folder)} aria-label={`Delete ${folder.name}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <span className="text-xs group-hover:hidden">{folderCounts.get(folder.id) ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main list */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Automations</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every flow and comment automation, in one place.
              </p>
            </div>
            <div className="relative">
              <button
                onClick={() => setNewAutomationOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" /> New automation <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {newAutomationOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setNewAutomationOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-lg">
                    <Link
                      href="/dashboard/flows/templates"
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent"
                      onClick={() => setNewAutomationOpen(false)}
                    >
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      Browse templates
                    </Link>
                    <Link
                      href="/dashboard/automations/basic"
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent"
                      onClick={() => setNewAutomationOpen(false)}
                    >
                      <Zap className="h-4 w-4 text-muted-foreground" />
                      Basic automations
                    </Link>
                    <button
                      onClick={handleCreateFlow}
                      disabled={creatingFlow}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                    >
                      {creatingFlow ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <GitBranch className="h-4 w-4 text-muted-foreground" />
                      )}
                      Start from scratch (Flow)
                    </button>
                    <Link
                      href="/dashboard/automations/new"
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent"
                      onClick={() => setNewAutomationOpen(false)}
                    >
                      <MessageCircleReply className="h-4 w-4 text-muted-foreground" />
                      Comment automation
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {visibleItems.length === 0 ? (
            <div className="mx-auto max-w-md rounded-2xl border border-dashed border-border p-10 text-center">
              <GitBranch className="mx-auto h-10 w-10 text-muted-foreground" />
              <h2 className="mt-4 font-semibold">No automations here yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a flow, set up a comment automation, or start from a template.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Name</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">Channels</th>
                    <th className="px-4 py-2.5 text-left font-medium">Stats</th>
                    <th className="px-4 py-2.5 text-left font-medium">Updated</th>
                    <th className="px-4 py-2.5 text-left font-medium">Folder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleItems.map((item) => {
                    const status = statusConfig[item.status];
                    return (
                      <tr key={`${item.kind}-${item.id}`} className="hover:bg-accent/30">
                        <td className="px-4 py-3">
                          <Link href={item.href} className="flex items-center gap-2 font-medium hover:text-primary">
                            {item.kind === "flow" ? (
                              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <MessageCircleReply className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            {item.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", status.classes)}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {item.platforms.length === 0 ? (
                            <span className="text-xs text-muted-foreground">All channels</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {item.platforms.map((p) => (
                                <PlatformIcon key={p} platform={p} size={14} />
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{item.stat}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(item.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <select
                            value={item.folderId ?? ""}
                            disabled={busyItemId === item.id}
                            onChange={(e) => handleMoveToFolder(item, e.target.value || null)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                          >
                            <option value="">No folder</option>
                            {folders.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create/rename folder dialog */}
      {folderDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setFolderDialog(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 className="text-sm font-semibold">
              {folderDialog.mode === "create" ? "New folder" : "Rename folder"}
            </h3>
            <input
              autoFocus
              value={folderNameInput}
              onChange={(e) => setFolderNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveFolder()}
              placeholder="Folder name"
              className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setFolderDialog(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFolder}
                disabled={savingFolder || !folderNameInput.trim()}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {savingFolder ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteFolderTarget}
        title="Delete folder"
        message={`"${deleteFolderTarget?.name}" will be removed. Automations inside it become unfiled — nothing is deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteFolder}
        onCancel={() => setDeleteFolderTarget(null)}
      />
    </div>
  );
}
