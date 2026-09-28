import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Duplicates a flow (nodes/edges/viewport) plus its triggers, as a new
// unpublished draft — mirrors the "duplicate" action available on comment
// automations, but flows additionally own trigger rows that have to be
// copied alongside them for the clone to actually fire the same way once
// published.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const { data: original, error: fetchError } = await supabase
    .from("flows")
    .select("name, description, nodes, edges, viewport, folder_id, triggers(channel_id, type, config, priority, is_active)")
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (fetchError || !original)
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });

  const { data: copy, error: insertError } = await supabase
    .from("flows")
    .insert({
      workspace_id: membership.workspace_id,
      name: `${original.name} (copy)`,
      description: original.description,
      nodes: original.nodes,
      edges: original.edges,
      viewport: original.viewport,
      folder_id: original.folder_id,
      status: "draft",
    })
    .select("id, name, status, folder_id, updated_at, nodes")
    .single();

  if (insertError || !copy)
    return NextResponse.json({ error: insertError?.message || "Failed to duplicate flow" }, { status: 500 });

  const triggerRows = (original.triggers ?? []).map((t) => ({
    flow_id: copy.id,
    channel_id: t.channel_id,
    type: t.type,
    config: t.config,
    priority: t.priority,
    is_active: t.is_active,
  }));

  if (triggerRows.length) {
    const { error: triggersError } = await supabase.from("triggers").insert(triggerRows);
    if (triggersError) {
      // The flow copy itself succeeded; a trigger-copy failure just means
      // the clone needs its trigger re-set before publishing — not worth
      // rolling back the whole duplicate over.
      console.error("Failed to copy triggers for duplicated flow:", triggersError);
    }
  }

  return NextResponse.json(copy, { status: 201 });
}
