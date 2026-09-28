"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];

// Workspace-wide "something needs your attention" alert: fires a desktop
// notification, a short beep, and a flashing tab title whenever a
// conversation's unread_count goes up (a new inbound DM, wherever the
// operator currently is in the app — not just while the Inbox page is open).
// Mounted once in the dashboard layout, not the inbox page, for that reason.
//
// This intentionally does NOT try to make anything faster: it just makes the
// operator aware the instant new activity lands, since the Realtime
// subscription itself already reflects the database the moment the webhook
// writes to it (see app/api/webhooks/late/route.ts) — the visible lag people
// perceive is almost always Instagram/Meta → Zernio → our webhook delivery,
// which happens before this ever fires, not anything downstream of it.
export function NewMessageWatcher({ workspaceId }: { workspaceId: string }) {
  const originalTitle = useRef<string | null>(null);
  const flashInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const stopFlashing = () => {
      if (flashInterval.current) {
        clearInterval(flashInterval.current);
        flashInterval.current = null;
      }
      if (originalTitle.current !== null) {
        document.title = originalTitle.current;
        originalTitle.current = null;
      }
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) stopFlashing();
    });
    window.addEventListener("focus", stopFlashing);
    return () => {
      window.removeEventListener("focus", stopFlashing);
    };
  }, []);

  useEffect(() => {
    function playBeep() {
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
        osc.onended = () => ctx.close();
      } catch {
        // Audio isn't available (autoplay policy, unsupported browser, etc.) —
        // the desktop notification and title flash still get the point across.
      }
    }

    function flashTitle(text: string) {
      if (typeof document === "undefined" || !document.hidden) return;
      if (originalTitle.current === null) originalTitle.current = document.title;
      let on = false;
      flashInterval.current = setInterval(() => {
        document.title = on ? originalTitle.current! : text;
        on = !on;
      }, 1000);
    }

    function notify(name: string, preview: string | null) {
      playBeep();
      flashTitle("🔴 New message");
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(`New message from ${name}`, {
            body: preview || "Open the inbox to view it.",
            tag: "tegrax-flow-new-message",
          });
        } catch {
          // Some browsers (notably in-app/embedded webviews) throw on
          // `new Notification()` even when permission reads "granted".
        }
      }
    }

    const supabase = createClient();
    // display_name lives on `contacts`, not `conversations` — the Realtime
    // payload only ever carries the changed table's own columns, so a quick
    // lookup is needed to put a name in the notification.
    const contactNameCache = new Map<string, string>();

    async function contactName(contactId: string | null): Promise<string> {
      if (!contactId) return "a contact";
      if (contactNameCache.has(contactId)) return contactNameCache.get(contactId)!;
      const { data } = await supabase
        .from("contacts")
        .select("display_name")
        .eq("id", contactId)
        .single();
      const name = data?.display_name || "a contact";
      contactNameCache.set(contactId, name);
      return name;
    }

    const channel = supabase
      .channel("workspace-new-message-alert")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        async (payload) => {
          if (payload.eventType === "UPDATE") {
            const oldRow = payload.old as Partial<ConversationRow>;
            const newRow = payload.new as ConversationRow;
            const wentUp = (newRow.unread_count ?? 0) > (oldRow.unread_count ?? 0);
            if (!wentUp) return;
            notify(await contactName(newRow.contact_id), newRow.last_message_preview);
          } else if (payload.eventType === "INSERT") {
            const inserted = payload.new as ConversationRow;
            if ((inserted.unread_count ?? 0) <= 0) return;
            notify(await contactName(inserted.contact_id), inserted.last_message_preview);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  return null;
}
