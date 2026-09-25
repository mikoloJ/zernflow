import Link from "next/link";
import { MessageCircleReply, Plus } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { parseConfig } from "@/lib/comment-automation-config";
import { cn } from "@/lib/utils";

export default async function AutomationsPage() {
  const { workspace, supabase } = await getWorkspace();

  const [{ data: automations }, { data: channels }] = await Promise.all([
    supabase
      .from("comment_automations")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("channels")
      .select("id, platform, username, display_name")
      .eq("workspace_id", workspace.id),
  ]);

  const channelName = (id: string | null) => {
    const c = channels?.find((ch) => ch.id === id);
    if (!c) return "No account";
    return `${c.username ? `@${c.username}` : c.display_name ?? "Account"} · ${c.platform === "instagram" ? "Instagram" : "Facebook"}`;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Automations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Comment a keyword, get a DM. Set one up in a minute.
            </p>
          </div>
          <Link
            href="/dashboard/automations/new"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New automation
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {!automations?.length ? (
          <div className="mx-auto max-w-md rounded-2xl border border-dashed border-border p-10 text-center">
            <MessageCircleReply className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">No automations yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a post, choose a keyword like &quot;PT&quot;, and everyone who comments it gets your DM.
            </p>
            <Link
              href="/dashboard/automations/new"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Create your first
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {automations.map((a) => {
              const config = parseConfig(a.config);
              const thumb = config.postPreviews?.[0]?.picture;
              const target =
                config.postMode === "any"
                  ? "Any post"
                  : config.postMode === "next"
                    ? config.lockedPostId
                      ? "Next post (attached)"
                      : "Next post (waiting)"
                    : `${config.postIds.length} post${config.postIds.length === 1 ? "" : "s"}`;
              const words = config.keywordMode === "any" ? "Any comment" : config.keywords.join(", ");
              return (
                <Link
                  key={a.id}
                  href={`/dashboard/automations/${a.id}`}
                  className="flex gap-4 rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-md"
                >
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                        {target}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold">{a.name}</h3>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          a.is_active
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {a.is_active ? "Live" : "Paused"}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{channelName(a.channel_id)}</p>
                    <p className="mt-1 truncate text-xs">
                      <span className="text-muted-foreground">Keyword:</span> {words || "—"} ·{" "}
                      <span className="text-muted-foreground">{target}</span>
                    </p>
                    <div className="mt-2 flex gap-4 text-xs">
                      <Stat label="Comments" value={a.comments_matched} />
                      <Stat label="DMs sent" value={a.opening_dms_sent + a.link_dms_sent} />
                      <Stat label="Taps" value={a.button_taps} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-semibold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
