"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MessageSquare, MousePointerClick, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHandleConnected } from "./use-handle-connected";

export interface SendMessageNodeProps {
  label?: string;
  messages?: Array<{
    text?: string;
    imageUrl?: string;
    quickReplies?: Array<{ id?: string; title: string; payload: string }>;
    buttons?: Array<{ id?: string; title: string; type: string; payload?: string; url?: string }>;
  }>;
}

// A single routable row: a postback button or a quick reply, each wired to
// its own canvas connection via `handleId` (see engine.ts / resumeSession,
// which route a button tap to the specific edge sourced from this handle).
interface RoutableItem {
  handleId: string;
  title: string;
  kind: "button" | "quickReply";
}

function getRoutableItems(messages: SendMessageNodeProps["messages"]): RoutableItem[] {
  const items: RoutableItem[] = [];
  for (const m of messages || []) {
    for (const btn of m.buttons || []) {
      // URL buttons just open a link — they never message the bot back, so
      // there is nothing for the flow to route on.
      if (btn.type === "url" || !btn.id) continue;
      items.push({ handleId: `btn:${btn.id}`, title: btn.title || "Button", kind: "button" });
    }
    for (const qr of m.quickReplies || []) {
      if (!qr.id) continue;
      items.push({ handleId: `qr:${qr.id}`, title: qr.title || "Quick reply", kind: "quickReply" });
    }
  }
  return items;
}

/** One routable row — its own icon, label, and a connector dot that lights up
 * once wired to a next step, mirroring how ManyChat marks each button's own
 * connection point. */
function RoutableRow({ item }: { item: RoutableItem }) {
  const connected = useHandleConnected(item.handleId);
  const Icon = item.kind === "button" ? MousePointerClick : MessageCircle;

  return (
    <div className="relative flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 last:border-b-0">
      <Icon className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" />
      <span className="truncate pr-2 text-[11px] font-medium text-foreground">
        {item.title}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        id={item.handleId}
        style={{ top: "50%", right: -7, transform: "translateY(-50%)" }}
        className={cn(
          "!h-2.5 !w-2.5 !border-2 !transition-colors",
          connected ? "!border-blue-500 !bg-blue-500" : "!border-blue-400 !bg-white"
        )}
      />
    </div>
  );
}

export function SendMessageNode({ data, selected }: NodeProps) {
  const nodeData = data as SendMessageNodeProps;
  const label = nodeData.label || "Send Message";
  const firstMessage = nodeData.messages?.[0];
  const messageCount = nodeData.messages?.length || 0;
  const routableItems = getRoutableItems(nodeData.messages);
  const buttonCount =
    nodeData.messages?.reduce(
      (acc, m) => acc + (m.buttons?.length || 0) + (m.quickReplies?.length || 0),
      0
    ) || 0;
  const defaultPathConnected = useHandleConnected(undefined);

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected ? "border-blue-500 shadow-md" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-blue-500 !bg-white"
      />
      <div className="flex items-center gap-2 rounded-t-lg bg-blue-500 px-3 py-2 text-white">
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">Send Message</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{label}</p>
        {firstMessage?.text && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {firstMessage.text}
          </p>
        )}
        {!firstMessage?.text && firstMessage?.imageUrl && (
          <p className="mt-1 text-xs text-muted-foreground">Image message</p>
        )}
        {!firstMessage && (
          <p className="mt-1 text-xs text-muted-foreground italic">No message configured</p>
        )}
        <div className="mt-2 flex gap-2">
          {messageCount > 1 && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
              {messageCount} messages
            </span>
          )}
          {buttonCount > 0 && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
              {buttonCount} {buttonCount === 1 ? "button" : "buttons"}
            </span>
          )}
        </div>
      </div>

      {/* One row + connector per postback button / quick reply, so each can be
          wired to a different next node — the contact's tap decides the path. */}
      {routableItems.length > 0 && (
        <div className="border-t border-border">
          {routableItems.map((item) => (
            <RoutableRow key={item.handleId} item={item} />
          ))}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className={cn(
          "!h-3 !w-3 !border-2 !transition-colors",
          defaultPathConnected ? "!border-blue-500 !bg-blue-500" : "!border-blue-500 !bg-white"
        )}
      />
      {routableItems.length > 0 && (
        <p className="border-t border-border px-3 py-1 text-center text-[10px] text-muted-foreground">
          Default path (no button tapped)
        </p>
      )}
    </div>
  );
}
