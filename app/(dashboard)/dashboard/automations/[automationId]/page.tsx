import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { DEFAULT_CONFIG, parseConfig } from "@/lib/comment-automation-config";
import { AutomationEditor } from "@/components/automations/AutomationEditor";

export default async function AutomationEditorPage({
  params,
}: {
  params: Promise<{ automationId: string }>;
}) {
  const { automationId } = await params;
  const { workspace, supabase } = await getWorkspace();

  const { data: channels } = await supabase
    .from("channels")
    .select("id, platform, username, display_name, profile_picture")
    .eq("workspace_id", workspace.id)
    .eq("is_active", true)
    .in("platform", ["instagram", "facebook"])
    .order("created_at", { ascending: true });

  if (automationId === "new") {
    return (
      <AutomationEditor
        workspaceId={workspace.id}
        channels={channels ?? []}
        initial={{
          id: null,
          name: "",
          channelId: null,
          isActive: true,
          config: structuredClone(DEFAULT_CONFIG),
        }}
      />
    );
  }

  const { data: automation } = await supabase
    .from("comment_automations")
    .select("*")
    .eq("id", automationId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!automation) notFound();

  return (
    <AutomationEditor
      workspaceId={workspace.id}
      channels={channels ?? []}
      initial={{
        id: automation.id,
        name: automation.name,
        channelId: automation.channel_id,
        isActive: automation.is_active,
        config: parseConfig(automation.config),
      }}
    />
  );
}
