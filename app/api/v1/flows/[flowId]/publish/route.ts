import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { BUILDER_TRIGGER_TYPES, buildDesiredTriggers } from "@/lib/flow-triggers";

/** Stable-key JSON so two configs built in a different field order still compare equal. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Scopes every trigger row of a flow to the given channels, replacing however
 * many rows currently exist (one per distinct type+config+priority "rule")
 * with one row per selected channel — or a single unrestricted (channel_id
 * null) row per rule when `channelIds` is null ("all channels"). Applies to
 * every row regardless of managed_by_canvas, since channel scope is a
 * publish-time choice independent of who owns the row's content.
 */
async function applyChannelScope(
  supabase: SupabaseClient<Database>,
  flowId: string,
  channelIds: string[] | null,
) {
  const { data: current } = await supabase
    .from("triggers")
    .select("id, channel_id, type, config, priority, is_active, managed_by_canvas")
    .eq("flow_id", flowId);
  if (!current || current.length === 0) return;

  const groups = new Map<string, typeof current>();
  for (const row of current) {
    const sig = `${row.type}|${canonicalize(row.config)}|${row.priority}`;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(row);
  }

  const idsToDelete: string[] = [];
  const toInsert: Array<{
    flow_id: string;
    channel_id: string | null;
    type: Database["public"]["Tables"]["triggers"]["Row"]["type"];
    config: Json;
    priority: number;
    is_active: boolean;
    managed_by_canvas: boolean;
  }> = [];

  for (const rows of groups.values()) {
    const template = rows.find((r) => r.channel_id === null) ?? rows[0];
    idsToDelete.push(...rows.map((r) => r.id));

    const targets = !channelIds || channelIds.length === 0 ? [null] : channelIds;
    for (const channelId of targets) {
      toInsert.push({
        flow_id: flowId,
        channel_id: channelId,
        type: template.type,
        config: template.config,
        priority: template.priority,
        is_active: template.is_active,
        managed_by_canvas: template.managed_by_canvas,
      });
    }
  }

  await supabase.from("triggers").delete().in("id", idsToDelete);
  if (toInsert.length > 0) {
    await supabase.from("triggers").insert(toInsert);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const supabase = await createClient();

  // Optional: which channels this publish should scope the flow's triggers
  // to. Omitted (no body, or no channelIds key) skips channel scoping
  // entirely, for backward compatibility with any caller that predates it.
  // null/[] means "all channels" (unrestricted — the historical default).
  let channelIds: string[] | null | undefined;
  try {
    const body = await request.json();
    if (body && "channelIds" in body) channelIds = body.channelIds;
  } catch {
    // No/invalid JSON body — treat as "not provided".
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });

  // Get current flow
  const { data: flow, error } = await supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (error || !flow)
    return NextResponse.json(
      { error: error?.message || "Flow not found" },
      { status: 404 }
    );

  // Update flow status to published and increment version
  const newVersion = flow.version + 1;
  await supabase
    .from("flows")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      version: newVersion,
    })
    .eq("id", flowId);

  // Save version snapshot
  await supabase.from("flow_versions").insert({
    flow_id: flowId,
    version: newVersion,
    nodes: flow.nodes,
    edges: flow.edges,
    viewport: flow.viewport,
    name: flow.name,
    published_by: user.id,
  });

  // Sync trigger rows from the flow's trigger nodes into the `triggers` table.
  // The runtime matcher (lib/flow-engine/trigger-matcher.ts) reads triggers.config,
  // but the builder only ever saved keywords into flows.nodes — so triggers configured
  // in the UI never fired in production. Reconcile them here on publish. This includes
  // `comment_keyword`: builder-created rows are workspace-wide (channel_id null), while
  // Growth-tab rows are channel-scoped (channel_id set) and must survive republish —
  // hence the null-channel guard on the delete below. A comment_keyword node with
  // "also match in DMs" emits a second row typed `keyword` (see below), so both rows
  // are reconciled together on every republish.
  const flowNodes = Array.isArray(flow.nodes) ? (flow.nodes as Array<Record<string, unknown>>) : [];
  const desiredTriggers = buildDesiredTriggers(flowNodes, flowId);

  // A flow built outside the single-trigger-node model (multiple hand-built
  // keyword/quick_reply/postback rows, e.g. imported or scripted flows) has
  // its rows marked managed_by_canvas = false so they're never touched here.
  // Skip re-deriving a row whose exact rule (type+config+priority) a manual
  // row already covers — otherwise the two would sit side by side as an
  // identical, redundant duplicate.
  const { data: manualRows } = await supabase
    .from("triggers")
    .select("type, config, priority")
    .eq("flow_id", flowId)
    .eq("managed_by_canvas", false);
  const manualSignatures = new Set(
    (manualRows ?? []).map((r) => `${r.type}|${canonicalize(r.config)}|${r.priority}`),
  );
  const triggersToSync = desiredTriggers.filter(
    (t) => !manualSignatures.has(`${t.type}|${canonicalize(t.config)}|${t.priority}`),
  );

  // Reconcile: clear the canvas-managed trigger rows for this flow, then insert the
  // fresh set derived from the current node graph (delete-and-reinsert keeps the table
  // in sync with what was published and avoids duplicates on republish). Only
  // null-channel, canvas-managed rows are touched — manually-built rows (see above) and
  // channel-scoped Growth-tab rows are left alone.
  await supabase
    .from("triggers")
    .delete()
    .eq("flow_id", flowId)
    .eq("managed_by_canvas", true)
    .is("channel_id", null)
    .in("type", [...BUILDER_TRIGGER_TYPES]);

  if (triggersToSync.length > 0) {
    const { error: insertError } = await supabase
      .from("triggers")
      .insert(triggersToSync.map((t) => ({ ...t, managed_by_canvas: true })));
    if (insertError) {
      console.error("[publish] Failed to sync triggers from flow nodes:", insertError);
    }
  }

  // Activate any remaining triggers for this flow (e.g. comment_keyword managed elsewhere).
  await supabase
    .from("triggers")
    .update({ is_active: true })
    .eq("flow_id", flowId);

  // Apply the channel scope chosen in the publish dialog, if one was sent.
  if (channelIds !== undefined) {
    await applyChannelScope(supabase, flowId, channelIds);
  }

  return NextResponse.json({ ...flow, version: newVersion });
}
