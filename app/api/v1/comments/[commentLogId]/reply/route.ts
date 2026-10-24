import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";

/** Posts a manual public reply to a logged comment, from the Comments page. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ commentLogId: string }> },
) {
  const { commentLogId } = await params;
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

  let text: string;
  try {
    const body = await request.json();
    text = typeof body?.text === "string" ? body.text.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "Reply text is required" }, { status: 400 });

  const { data: log, error: logError } = await supabase
    .from("comment_logs")
    .select("id, post_id, platform_comment_id, channel_id, workspace_id")
    .eq("id", commentLogId)
    .eq("workspace_id", membership.workspace_id)
    .single();
  if (logError || !log)
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });

  if (!log.post_id)
    return NextResponse.json(
      { error: "This comment has no post reference and can't be replied to here" },
      { status: 400 },
    );

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("late_account_id")
    .eq("id", log.channel_id)
    .single();
  if (channelError || !channel)
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", log.workspace_id)
    .single();
  if (workspaceError || !workspace?.late_api_key_encrypted)
    return NextResponse.json({ error: "Workspace is not connected to Zernio" }, { status: 400 });

  try {
    const zernio = createZernioClient(workspace.late_api_key_encrypted);
    await zernio.comments.replyToInboxPost({
      path: { postId: log.post_id },
      body: {
        accountId: channel.late_account_id,
        message: text,
        commentId: log.platform_comment_id,
      },
    });
  } catch (err) {
    console.error("Failed to post manual comment reply:", err);
    const message = err instanceof Error ? err.message : "Failed to send reply";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const repliedAt = new Date().toISOString();
  await supabase
    .from("comment_logs")
    .update({ reply_sent: true, manual_reply_text: text, manual_replied_at: repliedAt })
    .eq("id", commentLogId);

  return NextResponse.json({ ok: true, repliedAt });
}
