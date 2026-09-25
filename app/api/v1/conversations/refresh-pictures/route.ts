import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";

const PAGES_PER_CHANNEL = 3;

/**
 * POST /api/v1/conversations/refresh-pictures
 * Refreshes contact profile pictures from Zernio's conversation list (one
 * call per 100 chats), so the inbox list shows faces rather than initials.
 * Meta picture links expire, so the inbox calls this when it opens.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(late_api_key_encrypted)")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  const workspace = membership?.workspaces as { late_api_key_encrypted: string | null } | null;
  if (!membership || !workspace?.late_api_key_encrypted) {
    return NextResponse.json({ updated: 0 });
  }

  const zernio = createZernioClient(workspace.late_api_key_encrypted);
  const { data: channels } = await supabase
    .from("channels")
    .select("id, late_account_id")
    .eq("workspace_id", membership.workspace_id)
    .eq("is_active", true);

  // Zernio conversation id -> participant picture
  const pictures = new Map<string, string>();
  for (const channel of channels ?? []) {
    let cursor: string | undefined;
    try {
      for (let page = 0; page < PAGES_PER_CHANNEL; page++) {
        const res = await zernio.messages.listInboxConversations({
          query: { accountId: channel.late_account_id, limit: 100, sortOrder: "desc", cursor },
        });
        const rows = (res.data?.data ?? []) as Array<{ id?: string; participantPicture?: string | null }>;
        for (const r of rows) if (r.id && r.participantPicture) pictures.set(r.id, r.participantPicture);
        const p = res.data?.pagination;
        if (!p?.hasMore || !p.nextCursor) break;
        cursor = p.nextCursor;
      }
    } catch (err) {
      console.error(`[refresh-pictures] channel ${channel.id} failed:`, err);
    }
  }
  if (!pictures.size) return NextResponse.json({ updated: 0 });

  const { data: conversations } = await supabase
    .from("conversations")
    .select("late_conversation_id, contact_id, contacts(avatar_url)")
    .eq("workspace_id", membership.workspace_id)
    .not("late_conversation_id", "is", null);

  const updates: Array<{ contactId: string; url: string }> = [];
  for (const c of conversations ?? []) {
    const url = c.late_conversation_id ? pictures.get(c.late_conversation_id) : undefined;
    const current = (c.contacts as { avatar_url: string | null } | null)?.avatar_url ?? null;
    if (url && c.contact_id && url !== current) updates.push({ contactId: c.contact_id, url });
  }

  for (let i = 0; i < updates.length; i += 20) {
    await Promise.all(
      updates
        .slice(i, i + 20)
        .map((u) => supabase.from("contacts").update({ avatar_url: u.url }).eq("id", u.contactId)),
    );
  }

  return NextResponse.json({ updated: updates.length });
}
