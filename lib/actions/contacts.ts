"use server";

import { getWorkspace } from "@/lib/workspace";
import { createZernioClient } from "@/lib/zernio-client";
import { revalidatePath } from "next/cache";

/**
 * Refresh a contact's Instagram follower status from Meta via Zernio.
 *
 * IMPORTANT: the underlying API can only ever confidently confirm "yes, this
 * person follows the account" — `isFollower` comes back `boolean | null`
 * where `null` means "unknown", never a confirmed "no". So this only ever
 * writes `true` (plus the checked-at timestamp); it never writes `false`,
 * to avoid recording a "not a follower" fact the platform never actually
 * asserted.
 */
export async function refreshFollowerStatus(contactId: string) {
  const { workspace, supabase } = await getWorkspace();

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, workspace_id")
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .single();
  if (!contact) return { error: "Contact not found" };

  // Find an Instagram channel this contact has a linked sender id on.
  const { data: links } = await supabase
    .from("contact_channels")
    .select("platform_sender_id, channels(id, platform, late_account_id)")
    .eq("contact_id", contactId);

  const igLink = (links ?? []).find(
    (l) => (l.channels as { platform?: string } | null)?.platform === "instagram"
  ) as
    | { platform_sender_id: string; channels: { late_account_id: string } | null }
    | undefined;

  if (!igLink?.channels?.late_account_id) {
    return { error: "No connected Instagram channel for this contact" };
  }

  if (!workspace.late_api_key_encrypted) {
    return { error: "No Zernio API key configured for this workspace" };
  }

  const zernio = createZernioClient(workspace.late_api_key_encrypted);

  const { data, error } = await zernio.accounts.getInstagramFollowStatus({
    path: {
      accountId: igLink.channels.late_account_id,
      userId: igLink.platform_sender_id,
    },
    query: { refresh: true },
  });

  if (error || !data) {
    return { error: "Could not reach Instagram to check follower status" };
  }

  // Never persist `false` — that would assert something the API doesn't.
  if (data.isFollower === true) {
    await supabase
      .from("contacts")
      .update({ is_follower: true, follower_checked_at: new Date().toISOString() })
      .eq("id", contactId);
  } else {
    // Still record that we checked, without claiming a "no".
    await supabase
      .from("contacts")
      .update({ follower_checked_at: new Date().toISOString() })
      .eq("id", contactId);
  }

  revalidatePath(`/dashboard/contacts/${contactId}`);
  revalidatePath("/dashboard/contacts");

  return { ok: true, isFollower: data.isFollower === true ? true : null };
}
