import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveContacts, type SegmentFilter } from "@/lib/segment-resolver";

/**
 * POST /api/v1/contacts/segment
 *
 * Resolves an ad-hoc segment filter (built in the Contacts page's segment
 * builder) into matching contact IDs, without creating a broadcast. Unlike
 * the broadcast send route, this does NOT restrict to subscribed contacts —
 * someone browsing Contacts may be looking for unsubscribed people too.
 */
export async function POST(request: NextRequest) {
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

  let filter: SegmentFilter | null = null;
  try {
    const body = await request.json();
    filter = (body?.filter ?? null) as SegmentFilter | null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const contactIds = await resolveContacts(supabase, membership.workspace_id, filter, {
    subscribedOnly: false,
  });

  return NextResponse.json({ contactIds });
}
