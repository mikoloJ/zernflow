import { getWorkspace } from "@/lib/workspace";
import { ContactsView } from "./contacts-view";

const PAGE_SIZE = 1000;
// Hard stop so a runaway workspace can't make this page fetch forever; real
// cursor/virtualized pagination in the UI is the right fix well before this.
const MAX_CONTACTS = 20000;

export default async function ContactsPage() {
  const { workspace, supabase } = await getWorkspace();

  const contactsQuery = () =>
    supabase
      .from("contacts")
      .select(
        "*, contact_tags(tag_id, tags(*)), contact_channels(platform_sender_id, channel_id, channels(platform))"
      )
      .eq("workspace_id", workspace.id)
      .order("last_interaction_at", { ascending: false, nullsFirst: false });

  // PostgREST caps a single request's rows (commonly 1000, regardless of
  // .limit()), so a workspace with more contacts than that would have had
  // the rest silently dropped from a single query. Page through with
  // .range() instead, so every contact actually loads, not just the first
  // page's worth.
  type ContactsPage = Awaited<ReturnType<typeof contactsQuery>>["data"];
  const allContacts: NonNullable<ContactsPage> = [];
  for (let offset = 0; offset < MAX_CONTACTS; offset += PAGE_SIZE) {
    const { data } = await contactsQuery().range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    allContacts.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const { data: tags } = await supabase
    .from("tags")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("name");

  return (
    <ContactsView
      contacts={allContacts}
      tags={tags ?? []}
      workspaceId={workspace.id}
    />
  );
}
