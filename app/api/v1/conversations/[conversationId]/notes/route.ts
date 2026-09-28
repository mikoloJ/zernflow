import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET/POST /api/v1/conversations/[conversationId]/notes
 *
 * Internal team notes on a conversation — the "Note" tab in the composer.
 * Never sent to Zernio/the platform; visible only inside the inbox.
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("conversation_notes")
    .select("id, conversation_id, author_name, text, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const text: string = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const { data: conversation } = await supabase
    .from("conversations")
    .select("workspace_id")
    .eq("id", conversationId)
    .single();
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const authorName = (user.user_metadata as { full_name?: string; name?: string } | null)?.full_name ||
    (user.user_metadata as { full_name?: string; name?: string } | null)?.name ||
    user.email ||
    "Teammate";

  const { data: note, error } = await supabase
    .from("conversation_notes")
    .insert({
      workspace_id: conversation.workspace_id,
      conversation_id: conversationId,
      author_id: user.id,
      author_name: authorName,
      text,
    })
    .select("id, conversation_id, author_name, text, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(note, { status: 201 });
}
