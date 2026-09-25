import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";

export interface ConversationProfile {
  name: string | null;
  username: string | null;
  picture: string | null;
  platform: string | null;
  instagram: {
    followerCount: number | null;
    isVerified: boolean | null;
    isFollower: boolean | null;
    isFollowing: boolean | null;
  } | null;
  /** Present when the conversation started from a Meta ad click. */
  ad: {
    adId: string | null;
    title: string | null;
    headline: string | null;
    photoUrl: string | null;
    videoUrl: string | null;
    postId: string | null;
    postUrl: string | null;
    sourceUrl: string | null;
    source: string | null;
    ref: string | null;
    capturedAt: string | null;
  } | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function postUrlFor(platform: string | null, postId: string | null): string | null {
  if (!postId) return null;
  // Facebook post ids are "{pageId}_{postId}" and resolve directly.
  if (platform === "facebook" || postId.includes("_")) return `https://www.facebook.com/${postId}`;
  return null;
}

/**
 * GET /api/v1/conversations/:id/profile
 * The participant's profile (picture, Instagram stats) and, when the chat was
 * started from an ad, which ad and post it came from. Also refreshes the
 * contact's stored avatar, since Meta profile picture URLs expire.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, workspace_id, contact_id, platform, late_conversation_id, channels(late_account_id)")
    .eq("id", conversationId)
    .single();
  if (!conversation?.late_conversation_id) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", conversation.workspace_id)
    .single();
  const accountId = (conversation.channels as { late_account_id: string } | null)?.late_account_id;
  if (!workspace?.late_api_key_encrypted || !accountId) {
    return NextResponse.json({ error: "Zernio is not connected" }, { status: 400 });
  }

  const zernio = createZernioClient(workspace.late_api_key_encrypted);

  let convo: any = null;
  try {
    const res = await zernio.messages.getInboxConversation({
      path: { conversationId: conversation.late_conversation_id },
      query: { accountId },
    });
    convo = (res.data as any)?.data ?? res.data ?? null;
  } catch (err) {
    console.error("getInboxConversation failed:", err);
  }

  // The single-conversation endpoint may omit the picture and WhatsApp
  // referral keys; the list endpoint carries both.
  if (!convo?.participantPicture || !convo?.metadata) {
    try {
      const res = await zernio.messages.listInboxConversations({ query: { accountId, limit: 100 } as any });
      const rows = ((res.data as any)?.data ?? []) as any[];
      const hit = rows.find((r) => r.id === conversation.late_conversation_id);
      if (hit) convo = { ...hit, ...(convo ?? {}), participantPicture: convo?.participantPicture ?? hit.participantPicture, metadata: convo?.metadata ?? hit.metadata };
    } catch (err) {
      console.error("listInboxConversations failed:", err);
    }
  }

  const meta = (convo?.metadata ?? {}) as Record<string, string | undefined>;
  const hasMetaAd = !!meta.meta_ad_id;
  const hasCtwa = !!(meta.ctwa_source_id || meta.ctwa_clid || meta.ctwa_source_url);
  const postId = meta.meta_ad_post_id ?? null;

  const profile: ConversationProfile = {
    name: convo?.participantName ?? null,
    username: convo?.participantUsername ?? null,
    picture: convo?.participantPicture ?? null,
    platform: conversation.platform,
    instagram: convo?.instagramProfile
      ? {
          followerCount: convo.instagramProfile.followerCount ?? null,
          isVerified: convo.instagramProfile.isVerified ?? null,
          isFollower: convo.instagramProfile.isFollower ?? null,
          isFollowing: convo.instagramProfile.isFollowing ?? null,
        }
      : null,
    ad:
      hasMetaAd || hasCtwa
        ? {
            adId: meta.meta_ad_id ?? meta.ctwa_source_id ?? null,
            title: meta.meta_ad_title ?? null,
            headline: meta.ctwa_headline ?? null,
            photoUrl: meta.meta_ad_photo_url ?? null,
            videoUrl: meta.meta_ad_video_url ?? null,
            postId,
            postUrl: postUrlFor(conversation.platform, postId),
            sourceUrl: meta.ctwa_source_url ?? null,
            source: meta.meta_ad_source ?? meta.ctwa_source_type ?? null,
            ref: meta.meta_ad_ref ?? null,
            capturedAt: meta.meta_ad_captured_at ?? meta.ctwa_captured_at ?? null,
          }
        : null,
  };

  // Backfill the ad badge for chats that started before we captured it.
  if (profile.ad) {
    await supabase
      .from("conversations")
      .update({
        source: {
          kind: "ad",
          adId: profile.ad.adId,
          title: profile.ad.title ?? profile.ad.headline,
          photoUrl: profile.ad.photoUrl,
          videoUrl: profile.ad.videoUrl,
          postId: profile.ad.postId,
          sourceUrl: profile.ad.sourceUrl,
          sourceType: profile.ad.source,
          ref: profile.ad.ref,
          capturedAt: profile.ad.capturedAt,
        },
      })
      .eq("id", conversation.id)
      .is("source", null);
  }

  // Refresh the stored avatar (Meta CDN links expire after a while).
  if (profile.picture && conversation.contact_id) {
    await supabase
      .from("contacts")
      .update({ avatar_url: profile.picture })
      .eq("id", conversation.contact_id);
  }

  return NextResponse.json(profile);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
