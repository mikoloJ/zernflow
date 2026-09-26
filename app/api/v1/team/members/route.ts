import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/v1/team/members
 * Workspace members with display name/email, for assignment pickers.
 * auth.users needs the service client (RLS blocks it directly).
 */
export async function GET() {
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
  if (!membership) return NextResponse.json({ members: [] });

  const serviceClient = await createServiceClient();
  const { data: members } = await serviceClient
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", membership.workspace_id);

  const details = await Promise.all(
    (members ?? []).map(async (m) => {
      const {
        data: { user: memberUser },
      } = await serviceClient.auth.admin.getUserById(m.user_id);
      return {
        userId: m.user_id,
        role: m.role,
        email: memberUser?.email ?? "Unknown",
        name:
          memberUser?.user_metadata?.full_name ??
          memberUser?.user_metadata?.name ??
          memberUser?.email?.split("@")[0] ??
          "Unknown",
      };
    }),
  );

  return NextResponse.json({ members: details });
}
