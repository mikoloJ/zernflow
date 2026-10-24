import { getWorkspace } from "@/lib/workspace";
import { notFound } from "next/navigation";
import { FlowCanvas } from "@/components/flow-builder/flow-canvas";

export default async function FlowEditorPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const { workspace, supabase } = await getWorkspace();

  const [{ data: flow }, { data: channels }] = await Promise.all([
    supabase
      .from("flows")
      .select("*")
      .eq("id", flowId)
      .eq("workspace_id", workspace.id)
      .single(),
    supabase
      .from("channels")
      .select("id, platform, username, display_name")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true),
  ]);

  if (!flow) {
    notFound();
  }

  const { data: triggerChannels } = await supabase
    .from("triggers")
    .select("channel_id")
    .eq("flow_id", flowId);
  // null channel_id on any row means "unrestricted" (fires for every channel);
  // otherwise the flow is already scoped to whichever specific channels appear.
  const initialChannelIds =
    !triggerChannels ||
    triggerChannels.length === 0 ||
    triggerChannels.some((t) => t.channel_id === null)
      ? null
      : Array.from(new Set(triggerChannels.map((t) => t.channel_id as string)));

  return (
    <div className="flex h-full flex-col">
      <FlowCanvas flow={flow} channels={channels ?? []} initialChannelIds={initialChannelIds} />
    </div>
  );
}
