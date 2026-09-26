"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  Hand,
  Tags,
  Menu as MenuIcon,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// --- Types ---

interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

type PresetId = "default-reply" | "welcome-message" | "keyword-reply" | "main-menu";

interface MenuOption {
  title: string;
  reply: string;
}

const presetMeta: Record<
  PresetId,
  { name: string; description: string; icon: React.ElementType; iconColor: string; iconBg: string }
> = {
  "default-reply": {
    name: "Default Reply",
    description: "Answer anything that doesn't match another automation, so no message goes unanswered.",
    icon: MessageSquare,
    iconColor: "text-slate-600",
    iconBg: "bg-slate-100",
  },
  "welcome-message": {
    name: "Welcome Message",
    description: "Greet a contact the first time they message you on this channel.",
    icon: Hand,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-100",
  },
  "keyword-reply": {
    name: "Keyword Auto-Reply",
    description: "Reply automatically whenever a message contains one of your chosen keywords.",
    icon: Tags,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-100",
  },
  "main-menu": {
    name: "Main Menu",
    description: "Send a menu of quick-reply options, each with its own follow-up response.",
    icon: MenuIcon,
    iconColor: "text-green-600",
    iconBg: "bg-green-100",
  },
};

const presetOrder: PresetId[] = ["default-reply", "welcome-message", "keyword-reply", "main-menu"];

export function BasicAutomationsView() {
  const router = useRouter();
  const [openPreset, setOpenPreset] = useState<PresetId | null>(null);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<PresetId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [defaultReplyText, setDefaultReplyText] = useState(
    "Thanks for your message! A team member will get back to you shortly.",
  );
  const [welcomeText, setWelcomeText] = useState(
    "Hey there! Welcome! Thanks for reaching out — how can we help you today?",
  );
  const [keywordsInput, setKeywordsInput] = useState("");
  const [keywordReplyText, setKeywordReplyText] = useState("");
  const [menuIntro, setMenuIntro] = useState("Hi! What can we help you with?");
  const [menuOptions, setMenuOptions] = useState<MenuOption[]>([
    { title: "Pricing", reply: "" },
    { title: "Support", reply: "" },
  ]);

  async function createAndPublish(name: string, nodes: FlowNode[], edges: FlowEdge[], id: PresetId) {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, nodes, edges }),
      });
      if (!res.ok) throw new Error("Failed to create flow");
      const flow = await res.json();

      const publishRes = await fetch(`/api/v1/flows/${flow.id}/publish`, { method: "POST" });
      if (!publishRes.ok) throw new Error("Flow was created but could not be published");

      setJustCreated(id);
      setOpenPreset(null);
      router.refresh();
    } catch (err) {
      console.error("Failed to create basic automation:", err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  function handleDefaultReply() {
    const nodes: FlowNode[] = [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: { label: "Default Trigger", triggerType: "default" },
      },
      {
        id: "msg-1",
        type: "sendMessage",
        position: { x: 250, y: 150 },
        data: { label: "Default reply", messages: [{ text: defaultReplyText }] },
      },
    ];
    const edges: FlowEdge[] = [{ id: "e1", source: "trigger-1", target: "msg-1" }];
    void createAndPublish("Default Reply", nodes, edges, "default-reply");
  }

  function handleWelcomeMessage() {
    const nodes: FlowNode[] = [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: { label: "Welcome Trigger", triggerType: "welcome" },
      },
      {
        id: "msg-1",
        type: "sendMessage",
        position: { x: 250, y: 150 },
        data: { label: "Welcome message", messages: [{ text: welcomeText }] },
      },
    ];
    const edges: FlowEdge[] = [{ id: "e1", source: "trigger-1", target: "msg-1" }];
    void createAndPublish("Welcome Message", nodes, edges, "welcome-message");
  }

  function handleKeywordReply() {
    const keywords = keywordsInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((value) => ({ value, matchType: "contains" as const }));
    if (keywords.length === 0 || !keywordReplyText.trim()) return;

    const nodes: FlowNode[] = [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: { label: "Keyword Trigger", triggerType: "keyword", keywords },
      },
      {
        id: "msg-1",
        type: "sendMessage",
        position: { x: 250, y: 150 },
        data: { label: "Auto-reply", messages: [{ text: keywordReplyText }] },
      },
    ];
    const edges: FlowEdge[] = [{ id: "e1", source: "trigger-1", target: "msg-1" }];
    void createAndPublish(`Keyword Auto-Reply: ${keywords.map((k) => k.value).join(", ")}`, nodes, edges, "keyword-reply");
  }

  function handleMainMenu() {
    const validOptions = menuOptions.filter((o) => o.title.trim() && o.reply.trim());
    if (validOptions.length === 0) return;

    const nodes: FlowNode[] = [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: { label: "Menu Trigger", triggerType: "keyword", keywords: [{ value: "menu", matchType: "contains" as const }] },
      },
      {
        id: "menu-msg",
        type: "sendMessage",
        position: { x: 250, y: 150 },
        data: {
          label: "Main menu",
          messages: [
            {
              text: menuIntro,
              quickReplies: validOptions.map((o, i) => ({ title: o.title, payload: `MAIN_MENU_OPT_${i + 1}` })),
            },
          ],
        },
      },
    ];
    const edges: FlowEdge[] = [{ id: "e-menu", source: "trigger-1", target: "menu-msg" }];

    validOptions.forEach((option, i) => {
      const triggerId = `trigger-opt-${i + 1}`;
      const msgId = `msg-opt-${i + 1}`;
      nodes.push({
        id: triggerId,
        type: "trigger",
        position: { x: 250 + i * 220, y: 320 },
        data: {
          label: `"${option.title}" tapped`,
          triggerType: "quick_reply",
          payload: `MAIN_MENU_OPT_${i + 1}`,
        },
      });
      nodes.push({
        id: msgId,
        type: "sendMessage",
        position: { x: 250 + i * 220, y: 470 },
        data: { label: `${option.title} reply`, messages: [{ text: option.reply }] },
      });
      edges.push({ id: `e-opt-${i + 1}`, source: triggerId, target: msgId });
    });

    void createAndPublish("Main Menu", nodes, edges, "main-menu");
  }

  const submitHandlers: Record<PresetId, () => void> = {
    "default-reply": handleDefaultReply,
    "welcome-message": handleWelcomeMessage,
    "keyword-reply": handleKeywordReply,
    "main-menu": handleMainMenu,
  };

  function updateMenuOption(index: number, field: keyof MenuOption, value: string) {
    setMenuOptions((prev) => prev.map((o, i) => (i === index ? { ...o, [field]: value } : o)));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <Link
          href="/dashboard/automations"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Automations
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Basic Automations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One-click automations that go live immediately — no flow builder required.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="grid gap-6 sm:grid-cols-2">
          {presetOrder.map((id) => {
            const meta = presetMeta[id];
            const Icon = meta.icon;
            const isOpen = openPreset === id;
            const wasJustCreated = justCreated === id;

            return (
              <div
                key={id}
                className={cn(
                  "rounded-xl border border-border bg-card p-6 transition-colors",
                  isOpen ? "border-primary/50" : "hover:border-primary/50",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", meta.iconBg)}>
                    <Icon className={cn("h-5 w-5", meta.iconColor)} />
                  </div>
                  {wasJustCreated && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Live
                    </span>
                  )}
                </div>
                <h3 className="mt-4 text-sm font-semibold">{meta.name}</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{meta.description}</p>

                {!isOpen ? (
                  <button
                    onClick={() => {
                      setOpenPreset(id);
                      setError(null);
                    }}
                    className="mt-4 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
                  >
                    Set up
                  </button>
                ) : (
                  <div className="mt-4 space-y-3 border-t border-border pt-4">
                    {id === "default-reply" && (
                      <textarea
                        value={defaultReplyText}
                        onChange={(e) => setDefaultReplyText(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        placeholder="What should we say?"
                      />
                    )}
                    {id === "welcome-message" && (
                      <textarea
                        value={welcomeText}
                        onChange={(e) => setWelcomeText(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        placeholder="What should we say?"
                      />
                    )}
                    {id === "keyword-reply" && (
                      <>
                        <input
                          value={keywordsInput}
                          onChange={(e) => setKeywordsInput(e.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                          placeholder="Keywords, comma separated (e.g. price, cost)"
                        />
                        <textarea
                          value={keywordReplyText}
                          onChange={(e) => setKeywordReplyText(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                          placeholder="What should we reply?"
                        />
                      </>
                    )}
                    {id === "main-menu" && (
                      <>
                        <textarea
                          value={menuIntro}
                          onChange={(e) => setMenuIntro(e.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                          placeholder="Menu intro message"
                        />
                        {menuOptions.map((option, i) => (
                          <div key={i} className="grid grid-cols-2 gap-2">
                            <input
                              value={option.title}
                              onChange={(e) => updateMenuOption(i, "title", e.target.value)}
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                              placeholder={`Option ${i + 1} title`}
                            />
                            <input
                              value={option.reply}
                              onChange={(e) => updateMenuOption(i, "reply", e.target.value)}
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                              placeholder="Reply when tapped"
                            />
                          </div>
                        ))}
                        {menuOptions.length < 4 && (
                          <button
                            onClick={() => setMenuOptions((prev) => [...prev, { title: "", reply: "" }])}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            + Add option
                          </button>
                        )}
                      </>
                    )}

                    {error && <p className="text-xs text-red-600">{error}</p>}

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => setOpenPreset(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={submitHandlers[id]}
                        disabled={creating}
                        className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {creating ? (
                          <span className="inline-flex items-center justify-center gap-1.5">
                            <Loader2 className="h-3 w-3 animate-spin" /> Publishing...
                          </span>
                        ) : (
                          "Create & go live"
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
