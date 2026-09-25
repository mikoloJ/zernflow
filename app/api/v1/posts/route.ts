import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";
import { createZernioClient } from "@/lib/zernio-client";

/** Platforms whose posts can carry comment-to-DM automations. */
const COMMENT_PLATFORMS = ["instagram", "facebook"] as const;

export interface PickerPost {
  id: string;
  platform: string;
  channelId: string;
  channelName: string;
  content: string;
  picture: string | null;
  permalink: string | null;
  createdTime: string | null;
  commentCount: number;
}

interface ZernioPostRow {
  id?: string;
  platform?: string;
  content?: string;
  picture?: string | null;
  permalink?: string | null;
  createdTime?: string;
  commentCount?: number;
  isAd?: boolean;
}

/**
 * GET /api/v1/posts
 * Recent Instagram/Facebook posts across the workspace's connected channels,
 * newest first, for the comment-trigger post picker. Includes posts made
 * natively in the app (not only ones published through Zernio).
 */
export async function GET() {
  const { workspace, supabase } = await getWorkspace();

  if (!workspace.late_api_key_encrypted) {
    return NextResponse.json(
      { error: "Add your Zernio API key in Settings first." },
      { status: 400 },
    );
  }

  const { data: channels } = await supabase
    .from("channels")
    .select("id, platform, late_account_id, username, display_name")
    .eq("workspace_id", workspace.id)
    .eq("is_active", true)
    .in("platform", [...COMMENT_PLATFORMS]);

  if (!channels?.length) {
    return NextResponse.json({ posts: [], failed: [] });
  }

  const zernio = createZernioClient(workspace.late_api_key_encrypted);
  const failed: string[] = [];

  const perChannel = await Promise.all(
    channels.map(async (channel) => {
      const channelName =
        channel.username || channel.display_name || channel.platform;
      try {
        const res = await zernio.comments.listInboxComments({
          query: {
            accountId: channel.late_account_id,
            limit: 30,
            sortBy: "date",
            sortOrder: "desc",
          },
        });
        const rows = ((res.data as { data?: ZernioPostRow[] } | undefined)?.data ??
          []) as ZernioPostRow[];
        return rows
          .filter((p) => p.id && !p.isAd)
          .map<PickerPost>((p) => ({
            id: p.id as string,
            platform: p.platform ?? channel.platform,
            channelId: channel.id,
            channelName,
            content: p.content ?? "",
            picture: p.picture ?? null,
            permalink: p.permalink ?? null,
            createdTime: p.createdTime ?? null,
            commentCount: p.commentCount ?? 0,
          }));
      } catch (err) {
        console.error(`Failed to list posts for channel ${channel.id}:`, err);
        failed.push(channelName);
        return [];
      }
    }),
  );

  const posts = perChannel
    .flat()
    .sort(
      (a, b) =>
        new Date(b.createdTime ?? 0).getTime() -
        new Date(a.createdTime ?? 0).getTime(),
    );

  return NextResponse.json({ posts, failed });
}
