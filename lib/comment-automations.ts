import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { createZernioClient } from "@/lib/zernio-client";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { messagePreview } from "@/lib/message-preview";

import {
  buttonPayload,
  interpolate,
  matchAutomation,
  parseButtonPayload,
  parseConfig,
  pickRandom,
  validLinkButtons,
  type AutomationConfig,
  type CommentAutomationRow,
} from "@/lib/comment-automation-config";

export * from "@/lib/comment-automation-config";

type Channel = Database["public"]["Tables"]["channels"]["Row"];

// ── Runtime ─────────────────────────────────────────────────────────────────

async function bump(supabase: SupabaseClient<Database>, id: string, stat: string) {
  await supabase.rpc("bump_comment_automation_stat", { automation_id: id, stat });
}

export interface IncomingAutomationComment {
  id: string;
  postId: string;
  platformPostId?: string | null;
  text: string;
  author: { id?: string; name?: string; username?: string };
}

export interface AutomationResult {
  automationId: string;
  replySent: boolean;
  dmSent: boolean;
  error?: string;
}

/**
 * Try the channel's comment automations against one comment. Returns null when
 * none match (so the caller falls through to flow-builder triggers).
 */
export async function runCommentAutomations({
  supabase,
  channel,
  comment,
}: {
  supabase: SupabaseClient<Database>;
  channel: Channel;
  comment: IncomingAutomationComment;
}): Promise<AutomationResult | null> {
  const { data: automations } = await supabase
    .from("comment_automations")
    .select("*")
    .eq("workspace_id", channel.workspace_id)
    .eq("channel_id", channel.id)
    .eq("is_active", true);

  if (!automations?.length) return null;

  const match = matchAutomation(automations, {
    channelId: channel.id,
    postId: comment.postId,
    platformPostId: comment.platformPostId,
    text: comment.text,
  });
  if (!match) return null;

  const { automation } = match;
  const config = parseConfig(automation.config);

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", channel.workspace_id)
    .single();
  if (!workspace?.late_api_key_encrypted) return null;

  const zernio = createZernioClient(workspace.late_api_key_encrypted);

  if (match.needsNextPostCheck) {
    const locked = await lockNextPost({ supabase, zernio, channel, automation, config, comment });
    if (!locked) return null;
  }

  await bump(supabase, automation.id, "comments_matched");

  // Contact, so commenters land in Contacts for later broadcasts.
  const senderName = comment.author.name || comment.author.username || "Instagram user";
  const contact = comment.author.id
    ? await upsertContactForSender({
        supabase,
        channel,
        senderId: comment.author.id,
        senderName,
        senderPicture: null,
        senderUsername: comment.author.username || null,
        interactionAt: new Date().toISOString(),
      })
    : null;

  const firstName = (comment.author.name || comment.author.username || "").split(/\s+/)[0] || "there";
  const vars = {
    first_name: firstName,
    name: senderName,
    username: comment.author.username || "",
    comment: comment.text,
  };

  // Private reply first: Meta allows exactly one per comment, and it's what matters.
  let dmSent = false;
  let error: string | undefined;
  const usingOpeningDm = config.openingDm.enabled && config.openingDm.text.trim().length > 0;
  const dmMessage = usingOpeningDm ? interpolate(config.openingDm.text, vars) : interpolate(config.linkDm.text, vars);
  const dmButtons = usingOpeningDm
    ? [
        {
          type: "postback",
          title: (config.openingDm.buttonLabel || "Send it!").slice(0, 20),
          payload: buttonPayload(automation.id),
        },
      ]
    : validLinkButtons(config.linkDm.buttons);
  try {
    await zernio.comments.sendPrivateReplyToComment({
      path: { postId: comment.postId, commentId: comment.id },
      body: {
        accountId: channel.late_account_id,
        message: dmMessage,
        ...(dmButtons.length ? { buttons: dmButtons } : {}),
      } as never,
      throwOnError: true,
    });
    await bump(supabase, automation.id, usingOpeningDm ? "opening_dms_sent" : "link_dms_sent");
    dmSent = true;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[automation ${automation.id}] private reply failed:`, err);

    // Meta's private-reply endpoint allows exactly one reply per comment,
    // ever — a real platform limit, not a bug here. It fires when the same
    // person comments more than once (their first comment already used up
    // this thread's one shot). When that happens they usually already have
    // an open conversation from the earlier send, so fall back to a normal
    // inbox message on that conversation rather than silently dropping the
    // DM the automation promised.
    if (contact && /private reply|one private reply per comment/i.test(error)) {
      const { data: existingConversation } = await supabase
        .from("conversations")
        .select("late_conversation_id")
        .eq("channel_id", channel.id)
        .eq("contact_id", contact.contactId)
        .not("late_conversation_id", "is", null)
        .maybeSingle();

      if (existingConversation?.late_conversation_id) {
        try {
          const fallbackRes = await zernio.messages.sendInboxMessage({
            path: { conversationId: existingConversation.late_conversation_id },
            body: {
              accountId: channel.late_account_id,
              message: dmMessage,
              ...(dmButtons.length ? { buttons: dmButtons } : {}),
            } as never,
            throwOnError: true,
          });
          await bump(supabase, automation.id, usingOpeningDm ? "opening_dms_sent" : "link_dms_sent");
          dmSent = true;
          error = undefined;

          // Persist the conversation id Zernio actually sent on — it can
          // differ from what we had stored, and this send just proved it's
          // the live one. Otherwise a later manual send from the Inbox keeps
          // hitting the same stale id this fallback just worked around.
          const echoedConversationId = (fallbackRes.data as any)?.data?.conversationId as string | undefined;
          if (echoedConversationId && echoedConversationId !== existingConversation.late_conversation_id) {
            await supabase
              .from("conversations")
              .update({ late_conversation_id: echoedConversationId })
              .eq("channel_id", channel.id)
              .eq("contact_id", contact.contactId);
          }
        } catch (fallbackErr) {
          console.error(`[automation ${automation.id}] fallback DM send also failed:`, fallbackErr);
        }
      }
    }
  }

  // The private reply (or its fallback) above is the actual DM send, but
  // neither Zernio call touches our local `conversations` row — so without
  // this, a contact who only ever interacts via comment automations never
  // gets last_message_at bumped and their thread never sorts to the top of
  // the Inbox, no matter how many automation DMs actually went out.
  if (dmSent && contact) {
    await supabase.from("conversations").upsert(
      {
        workspace_id: channel.workspace_id,
        channel_id: channel.id,
        contact_id: contact.contactId,
        platform: channel.platform,
        last_message_at: new Date().toISOString(),
        last_message_preview: messagePreview(dmMessage),
        unread_count: 0,
      },
      { onConflict: "channel_id,contact_id" }
    );
  }

  let replySent = false;
  const reply = config.publicReply.enabled
    ? pickRandom(config.publicReply.replies.filter((r) => r.trim()))
    : undefined;
  if (reply) {
    try {
      await zernio.comments.replyToInboxPost({
        path: { postId: comment.postId },
        body: {
          accountId: channel.late_account_id,
          message: interpolate(reply, vars),
          commentId: comment.id,
        },
        throwOnError: true,
      });
      replySent = true;
      await bump(supabase, automation.id, "replies_posted");
    } catch (err) {
      console.error(`[automation ${automation.id}] public reply failed:`, err);
    }
  }

  return { automationId: automation.id, replySent, dmSent, error };
}

/**
 * "Next post" mode: the first post created after the automation was set up
 * becomes its post. Looks the commented post up among the account's latest.
 */
async function lockNextPost({
  supabase,
  zernio,
  channel,
  automation,
  config,
  comment,
}: {
  supabase: SupabaseClient<Database>;
  zernio: ReturnType<typeof createZernioClient>;
  channel: Channel;
  automation: CommentAutomationRow;
  config: AutomationConfig;
  comment: IncomingAutomationComment;
}): Promise<boolean> {
  const after = config.nextAfter ? new Date(config.nextAfter).getTime() : new Date(automation.created_at).getTime();
  try {
    const res = await zernio.comments.listInboxComments({
      query: { accountId: channel.late_account_id, limit: 10, sortBy: "date", sortOrder: "desc" },
    });
    const rows = ((res.data as { data?: Array<{ id?: string; createdTime?: string; picture?: string | null; content?: string }> } | undefined)?.data ?? []);
    const ids = [comment.postId, comment.platformPostId].filter(Boolean);
    const post = rows.find((r) => r.id && ids.includes(r.id));
    if (!post?.createdTime || new Date(post.createdTime).getTime() <= after) return false;

    const next: AutomationConfig = {
      ...config,
      lockedPostId: post.id,
      postPreviews: [{ id: post.id!, picture: post.picture ?? null, content: post.content ?? "" }],
    };
    await supabase
      .from("comment_automations")
      .update({ config: next as unknown as Json })
      .eq("id", automation.id);
    return true;
  } catch (err) {
    console.error(`[automation ${automation.id}] next-post lookup failed:`, err);
    return false;
  }
}

/**
 * The commenter tapped the opening DM's button: send the DM with the links.
 * Returns true when the payload belonged to an automation (handled or not), so
 * the caller skips flow triggers for it.
 */
export async function handleAutomationButtonTap({
  supabase,
  channel,
  payload,
  lateConversationId,
  sender,
}: {
  supabase: SupabaseClient<Database>;
  channel: Channel;
  payload: string | undefined;
  lateConversationId: string;
  sender: { name?: string; username?: string | null };
}): Promise<boolean> {
  const automationId = parseButtonPayload(payload);
  if (!automationId) return false;

  const { data: automation } = await supabase
    .from("comment_automations")
    .select("*")
    .eq("id", automationId)
    .eq("workspace_id", channel.workspace_id)
    .single();
  if (!automation) return true;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", channel.workspace_id)
    .single();
  if (!workspace?.late_api_key_encrypted) return true;

  await bump(supabase, automation.id, "button_taps");

  const config = parseConfig(automation.config);
  const firstName = (sender.name || sender.username || "").split(/\s+/)[0] || "there";
  const buttons = validLinkButtons(config.linkDm.buttons);
  const zernio = createZernioClient(workspace.late_api_key_encrypted);

  try {
    await zernio.messages.sendInboxMessage({
      path: { conversationId: lateConversationId },
      body: {
        accountId: channel.late_account_id,
        message: interpolate(config.linkDm.text, {
          first_name: firstName,
          name: sender.name || "",
          username: sender.username || "",
        }),
        ...(buttons.length ? { buttons } : {}),
      } as never,
      throwOnError: true,
    });
    await bump(supabase, automation.id, "link_dms_sent");

    // Same reasoning as the manual-send API route and the flow engine: clear
    // unread instantly rather than leaving it to a webhook echo of this same
    // send, so the inbox doesn't sit on a stale unread badge after the bot
    // has already replied.
    await supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("channel_id", channel.id)
      .eq("late_conversation_id", lateConversationId);
  } catch (err) {
    console.error(`[automation ${automation.id}] link DM failed:`, err);
  }
  return true;
}
