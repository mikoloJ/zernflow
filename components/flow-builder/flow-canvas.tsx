"use client";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Rocket, Loader2, History, Play, Download, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PlatformIcon } from "@/components/platform-icon";
import { createClient } from "@/lib/supabase/client";
import type { Database, FlowStatus, Json } from "@/lib/types/database";

import { NodePalette } from "./node-palette";
import { TriggerNode } from "./nodes/trigger-node";
import { SendMessageNode } from "./nodes/send-message-node";
import { ConditionNode } from "./nodes/condition-node";
import { DelayNode } from "./nodes/delay-node";
import { ActionNode } from "./nodes/action-node";
import { AiResponseNode } from "./nodes/AiResponseNode";
import { NodeConfigSidebar } from "./panels/NodeConfigSidebar";
import { VersionHistoryPanel } from "./panels/VersionHistoryPanel";
import { TestPanel } from "./panels/TestPanel";

type Flow = Database["public"]["Tables"]["flows"]["Row"];

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  sendMessage: SendMessageNode,
  condition: ConditionNode,
  delay: DelayNode,
  action: ActionNode,
  aiResponse: AiResponseNode,
  // The flow engine (lib/flow-engine/engine.ts) and simulator execute nodes
  // by these specific type strings directly, rather than a generic "action"
  // type with a data.actionType discriminator. Route each one to ActionNode
  // too, so a flow built or imported with these types (not just ones built
  // via the node palette, which always uses "action") still renders instead
  // of falling back to React Flow's blank default node.
  addTag: ActionNode,
  removeTag: ActionNode,
  setCustomField: ActionNode,
  httpRequest: ActionNode,
  goToFlow: ActionNode,
  humanTakeover: ActionNode,
  subscribe: ActionNode,
  unsubscribe: ActionNode,
  commentReply: ActionNode,
  privateReply: ActionNode,
  abSplit: ActionNode,
  smartDelay: ActionNode,
  enrollSequence: ActionNode,
};

type ChannelRow = {
  id: string;
  platform: string;
  username: string | null;
  display_name: string | null;
};

interface FlowCanvasProps {
  flow: Flow;
  channels?: ChannelRow[];
  initialChannelIds?: string[] | null;
}

let nodeId = 0;
function getNodeId() {
  return `node_${Date.now()}_${nodeId++}`;
}

function getDefaultData(type: string, actionType?: string): Record<string, unknown> {
  switch (type) {
    case "trigger":
      return { triggerType: "keyword", keywords: [] };
    case "sendMessage":
      return { messages: [] };
    case "condition":
      return { conditions: [], logic: "and" };
    case "delay":
      return { duration: 5, unit: "minutes" };
    case "aiResponse":
      return { systemPrompt: "", model: "openai/gpt-4o-mini", temperature: 0.7, maxTokens: 500, contextMessages: 10 };
    case "action":
      return { actionType: actionType || "addTag" };
    default:
      return {};
  }
}

function FlowCanvasInner({ flow, channels = [], initialChannelIds = null }: FlowCanvasProps) {
  const router = useRouter();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const supabase = createClient();

  const initialNodes: Node[] = Array.isArray(flow.nodes)
    ? (flow.nodes as unknown as Node[])
    : [];
  const initialEdges: Edge[] = Array.isArray(flow.edges)
    ? (flow.edges as unknown as Edge[])
    : [];

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [flowName, setFlowName] = useState(flow.name);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(
    () => new Set(initialChannelIds ?? channels.map((c) => c.id)),
  );
  const [deleting, setDeleting] = useState(false);

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: "var(--border)", strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const raw = event.dataTransfer.getData("application/reactflow");
      if (!raw) return;

      const { type, nodeType, actionType } = JSON.parse(raw) as {
        type: string;
        nodeType: string;
        actionType?: string;
      };

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: getNodeId(),
        type,
        position,
        data: getDefaultData(type, actionType || nodeType),
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onNodeDataChange = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: newData } : n
        )
      );
    },
    [setNodes]
  );

  const closeSidebar = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges]
  );

  const saveFlow = useCallback(
    async (status?: FlowStatus) => {
      if (status === "published") {
        setPublishing(true);
      } else {
        setSaving(true);
      }

      try {
        const update: Database["public"]["Tables"]["flows"]["Update"] = {
          name: flowName,
          nodes: nodes as unknown as Json,
          edges: edges as unknown as Json,
          updated_at: new Date().toISOString(),
        };

        if (status) {
          update.status = status;
          if (status === "published") {
            update.published_at = new Date().toISOString();
          }
        }

        const { error } = await supabase
          .from("flows")
          .update(update)
          .eq("id", flow.id);

        if (error) {
          console.error("Failed to save flow:", error);
          setSaveError("Failed to save");
          setTimeout(() => setSaveError(null), 3000);
          return;
        }

        setSaveError(null);
        setLastSaved(new Date());
      } finally {
        setSaving(false);
        setPublishing(false);
      }
    },
    [flowName, nodes, edges, flow.id, supabase]
  );

  const handleSave = useCallback(() => saveFlow(), [saveFlow]);
  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/flows/${flow.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.error("Failed to delete flow");
        setSaveError("Failed to delete");
        setTimeout(() => setSaveError(null), 3000);
        setDeleting(false);
        return;
      }
      router.push("/dashboard/flows");
    } catch (err) {
      console.error("Failed to delete flow:", err);
      setSaveError("Failed to delete");
      setTimeout(() => setSaveError(null), 3000);
      setDeleting(false);
    }
  }, [flow.id, router]);
  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      // First save the current state
      await saveFlow();
      // channelIds: null means "all channels" (unrestricted); an array scopes
      // the flow's triggers to exactly those channels.
      const channelIds =
        channels.length === 0 || selectedChannelIds.size === channels.length
          ? null
          : Array.from(selectedChannelIds);
      // Then call the publish API which increments version and saves snapshot
      const res = await fetch(`/api/v1/flows/${flow.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelIds }),
      });
      if (!res.ok) {
        console.error("Failed to publish flow");
        setSaveError("Failed to publish");
        setTimeout(() => setSaveError(null), 3000);
        return;
      }
      setSaveError(null);
      setLastSaved(new Date());
      setPublishDialogOpen(false);
      router.refresh();
    } finally {
      setPublishing(false);
    }
  }, [saveFlow, flow.id, channels, selectedChannelIds, router]);

  const toggleChannel = useCallback((channelId: string) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard/flows")}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="h-5 w-px bg-border" />
          <input
            type="text"
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            className="w-auto max-w-[200px] border-none bg-transparent text-sm font-semibold outline-none focus:ring-0"
            style={{ width: `${Math.max(flowName.length, 8)}ch` }}
            placeholder="Flow name"
          />
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
              flow.status === "published"
                ? "bg-emerald-100 text-emerald-800"
                : flow.status === "archived"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {flow.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saveError && (
            <span className="text-xs font-medium text-destructive">
              {saveError}
            </span>
          )}
          {!saveError && lastSaved && (
            <span className="text-xs text-muted-foreground">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => {
              setTestPanelOpen(!testPanelOpen);
              if (!testPanelOpen) {
                setVersionPanelOpen(false);
                setSelectedNodeId(null);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              testPanelOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent"
            )}
          >
            <Play className="h-3.5 w-3.5" />
            Test
          </button>
          <button
            onClick={() => {
              setVersionPanelOpen(!versionPanelOpen);
              if (!versionPanelOpen) {
                setTestPanelOpen(false);
                setSelectedNodeId(null);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              versionPanelOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent"
            )}
          >
            <History className="h-3.5 w-3.5" />
            History
          </button>
          <button
            onClick={() => {
              const exportData = {
                name: flowName,
                description: flow.description || null,
                nodes,
                edges,
                version: flow.version || 1,
                exportedAt: new Date().toISOString(),
                source: "zernflow",
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${flowName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.flow.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </button>
          <button
            onClick={() => setPublishDialogOpen(true)}
            disabled={publishing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {publishing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            Publish
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            title="Delete flow"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
          <ConfirmDialog
            open={confirmDelete}
            title="Delete flow"
            message={`"${flowName}" and its triggers, versions, and run history will be permanently deleted. This cannot be undone.`}
            confirmLabel="Delete"
            destructive
            onConfirm={() => {
              setConfirmDelete(false);
              handleDelete();
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      </div>

      {publishDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => !publishing && setPublishDialogOpen(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 className="text-sm font-semibold">Publish &ldquo;{flowName}&rdquo;</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose which connected channels this flow should respond on.
            </p>
            {channels.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                No channels connected yet — this flow will publish unrestricted and start
                responding as soon as a channel is connected.
              </p>
            ) : (
              <div className="mt-4 space-y-1.5">
                {channels.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannelIds.has(c.id)}
                      onChange={() => toggleChannel(c.id)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <PlatformIcon platform={c.platform} size={16} />
                    <span className="flex-1 truncate">
                      {c.display_name || c.username || c.platform}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">{c.platform}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPublishDialogOpen(false)}
                disabled={publishing}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing || (channels.length > 0 && selectedChannelIds.size === 0)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {publishing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Rocket className="h-3.5 w-3.5" />
                )}
                Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas area */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />
        <div ref={reactFlowWrapper} className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Background gap={16} size={1} className="!bg-background" />
            <Controls
              className="!border-border !bg-card !shadow-sm [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-accent"
            />
            <MiniMap
              className="!border-border !bg-card"
              nodeColor={() => "var(--primary)"}
              maskColor="rgba(0, 0, 0, 0.1)"
            />
          </ReactFlow>
        </div>
        {selectedNode && !versionPanelOpen && !testPanelOpen && (
          <NodeConfigSidebar
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            onChange={onNodeDataChange}
            onClose={closeSidebar}
            onDelete={deleteNode}
          />
        )}
        {versionPanelOpen && (
          <VersionHistoryPanel
            flowId={flow.id}
            currentVersion={flow.version}
            onClose={() => setVersionPanelOpen(false)}
            onRestore={() => router.refresh()}
          />
        )}
        {testPanelOpen && (
          <TestPanel
            nodes={nodes}
            edges={edges}
            onClose={() => setTestPanelOpen(false)}
            onHighlightNode={(nodeId) => {
              // Scroll to and highlight the node
              const node = nodes.find((n) => n.id === nodeId);
              if (node) setSelectedNodeId(nodeId);
            }}
          />
        )}
      </div>
    </div>
  );
}

export function FlowCanvas({ flow }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner flow={flow} />
    </ReactFlowProvider>
  );
}
