import { getWorkspace } from "@/lib/workspace";
import { ContactsView } from "./contacts-view";

export default async function ContactsPage() {
  const { workspace, supabase } = await getWorkspace();

  const [contactsRes, tagsRes] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "*, contact_tags(tag_id, tags(*)), contact_channels(platform_sender_id, channel_id, channels(platform))"
      )
      .eq("workspace_id", workspace.id)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      // No plan-based contact cap exists in this build — this limit is just
      // how many rows load into the initial table view, not a ceiling on
      // how many contacts the workspace can have.
      .limit(500),
    supabase
      .from("tags")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("name"),
  ]);

  return (
    <ContactsView
      contacts={contactsRes.data ?? []}
      tags={tagsRes.data ?? []}
      workspaceId={workspace.id}
    />
  );
}
