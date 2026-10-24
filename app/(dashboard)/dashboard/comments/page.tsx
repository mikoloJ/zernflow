import { getWorkspace } from "@/lib/workspace";
import { CommentsView } from "./comments-view";

export default async function CommentsPage() {
  const { workspace, supabase } = await getWorkspace();

  const [{ data: comments }, { data: channels }] = await Promise.all([
    supabase
      .from("comment_logs")
      .select(
        "id, channel_id, post_id, author_name, author_username, comment_text, dm_sent, reply_sent, manual_reply_text, manual_replied_at, error, created_at",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("channels")
      .select("id, platform, username, display_name")
      .eq("workspace_id", workspace.id),
  ]);

  return <CommentsView comments={comments ?? []} channels={channels ?? []} />;
}
