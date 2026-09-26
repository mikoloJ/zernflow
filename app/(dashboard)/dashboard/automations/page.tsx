import { getWorkspace } from "@/lib/workspace";
import { AutomationsHubView } from "@/components/automations/automations-hub-view";

export default async function AutomationsPage() {
  const { workspace, supabase } = await getWorkspace();

  const [{ data: flows }, { data: commentAutomations }, { data: folders }, { data: channels }] =
    await Promise.all([
      supabase
        .from("flows")
        .select("id, name, status, folder_id, updated_at, nodes")
        .eq("workspace_id", workspace.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("comment_automations")
        .select(
          "id, name, is_active, channel_id, folder_id, updated_at, comments_matched, opening_dms_sent, link_dms_sent, button_taps",
        )
        .eq("workspace_id", workspace.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("automation_folders")
        .select("id, name, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("channels")
        .select("id, platform, username, display_name")
        .eq("workspace_id", workspace.id),
    ]);

  const flowIds = (flows ?? []).map((f) => f.id);
  const { data: triggers } = flowIds.length
    ? await supabase.from("triggers").select("flow_id, channel_id, type").in("flow_id", flowIds)
    : { data: [] };

  return (
    <AutomationsHubView
      workspaceId={workspace.id}
      flows={flows ?? []}
      commentAutomations={commentAutomations ?? []}
      folders={folders ?? []}
      channels={channels ?? []}
      triggers={triggers ?? []}
    />
  );
}
