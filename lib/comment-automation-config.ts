/** Shared (client + server) comment automation config and matching. */
import type { Database, Json } from "@/lib/types/database";

export type CommentAutomationRow =
  Database["public"]["Tables"]["comment_automations"]["Row"];

// ── Config ──────────────────────────────────────────────────────────────────

export interface LinkButton {
  label: string;
  url: string;
}

export interface OpeningDmButton {
  /** Stable id, used to encode which button was tapped in the postback
   * payload (see buttonPayload/parseButtonPayload) so each button can route
   * to its own follow-up DM. */
  id: string;
  label: string;
  /** The "and then, they will get" DM sent when this specific button is
   * tapped — its own text and up to 3 of its own link buttons. */
  followUp: { text: string; buttons: LinkButton[] };
}

export interface AutomationConfig {
  /** specific = only postIds; any = every post; next = the next post published after nextAfter. */
  postMode: "specific" | "any" | "next";
  postIds: string[];
  /** Thumbnails/captions of the chosen posts, for the list and the preview. */
  postPreviews?: Array<{ id: string; picture: string | null; content: string }>;
  /** For postMode "next": posts created after this instant qualify. */
  nextAfter?: string;
  /** For postMode "next": set once the first qualifying post is seen. */
  lockedPostId?: string;

  keywordMode: "specific" | "any";
  keywords: string[];

  publicReply: { enabled: boolean; replies: string[] };

  openingDm: {
    enabled: boolean;
    text: string;
    /** Legacy single-button label, used only when `buttons` is empty (the
     * classic one-button "Send it!" -> top-level `linkDm` flow). */
    buttonLabel: string;
    /** Up to 3 postback buttons, each with its own follow-up DM. When set,
     * these replace the single "Send it!" button — every tap routes to that
     * specific button's own `followUp`, not the shared top-level `linkDm`. */
    buttons: OpeningDmButton[];
  };

  /** Legacy single follow-up DM, used only when openingDm.buttons is empty. */
  linkDm: { text: string; buttons: LinkButton[] };
}

export const DEFAULT_CONFIG: AutomationConfig = {
  postMode: "specific",
  postIds: [],
  postPreviews: [],
  keywordMode: "specific",
  keywords: [],
  publicReply: {
    enabled: true,
    replies: ["Sent! Check your DMs 📩", "Just sent you a message!", "Nice! Check your DMs 🙌"],
  },
  openingDm: {
    enabled: true,
    text: "Hey {{first_name}}! Thanks for your interest 🙌\n\nTap below and I'll send you the details.",
    buttonLabel: "Send it!",
    buttons: [],
  },
  linkDm: { text: "Here you go 👇", buttons: [{ label: "Open link", url: "" }] },
};

let fallbackIdCounter = 0;
function fallbackId(): string {
  fallbackIdCounter += 1;
  return `btn_${Date.now().toString(36)}_${fallbackIdCounter}`;
}

/** Defensive against stale shapes (e.g. a brief window where openingDm
 * buttons were plain {label,url} links with no id/followUp) — backfills
 * whatever's missing instead of letting old stored configs crash the editor. */
function normalizeOpeningButton(raw: unknown): OpeningDmButton {
  const b = (raw ?? {}) as Partial<OpeningDmButton> & { url?: string };
  return {
    id: typeof b.id === "string" && b.id ? b.id : fallbackId(),
    label: typeof b.label === "string" ? b.label : "",
    followUp: {
      text: b.followUp?.text ?? "",
      buttons: Array.isArray(b.followUp?.buttons)
        ? b.followUp.buttons
        // A legacy direct-link button (plain {label,url}) becomes a button
        // whose follow-up DM just carries that same link onward.
        : typeof b.url === "string" && b.url
          ? [{ label: b.label ?? "", url: b.url }]
          : [],
    },
  };
}

export function parseConfig(raw: Json | null | undefined): AutomationConfig {
  const c = (raw ?? {}) as Partial<AutomationConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...c,
    postIds: Array.isArray(c.postIds) ? c.postIds : [],
    keywords: Array.isArray(c.keywords) ? c.keywords : [],
    publicReply: { ...DEFAULT_CONFIG.publicReply, ...(c.publicReply ?? {}) },
    openingDm: {
      ...DEFAULT_CONFIG.openingDm,
      ...(c.openingDm ?? {}),
      buttons: Array.isArray(c.openingDm?.buttons)
        ? c.openingDm.buttons.map(normalizeOpeningButton)
        : [],
    },
    linkDm: { ...DEFAULT_CONFIG.linkDm, ...(c.linkDm ?? {}) },
  };
}

/** Keywords typed as "PT, pt course" in the UI -> normalized list. */
export function splitKeywords(input: string): string[] {
  return input
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// ── Matching (pure) ─────────────────────────────────────────────────────────

export interface CommentForAutomation {
  channelId: string;
  postId: string;
  platformPostId?: string | null;
  text: string;
}

function normalize(s: string) {
  return s.toLowerCase().normalize("NFKC").trim();
}

/** Whole-word/phrase match, so "PT" matches "PT please" and "pt!" but not "script". */
export function keywordMatches(text: string, keyword: string): boolean {
  const t = normalize(text);
  const k = normalize(keyword);
  if (!k) return false;
  if (t === k) return true;
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(t);
}

function postMatches(config: AutomationConfig, comment: CommentForAutomation): boolean | "check-next" {
  const ids = [comment.postId, comment.platformPostId].filter(Boolean) as string[];
  if (config.postMode === "any") return true;
  if (config.postMode === "specific") {
    return config.postIds.length > 0 && ids.some((id) => config.postIds.includes(id));
  }
  // next
  if (config.lockedPostId) return ids.includes(config.lockedPostId);
  return "check-next";
}

function textMatches(config: AutomationConfig, text: string): boolean {
  if (!normalize(text)) return false;
  if (config.keywordMode === "any") return true;
  return config.keywords.some((k) => keywordMatches(text, k));
}

/**
 * First active automation on this channel whose post + keyword rules match.
 * Specific-post automations win over "next post", which win over "any post",
 * so a targeted campaign isn't swallowed by a catch-all.
 */
export function matchAutomation(
  automations: CommentAutomationRow[],
  comment: CommentForAutomation,
): { automation: CommentAutomationRow; needsNextPostCheck: boolean } | null {
  const rank = { specific: 0, next: 1, any: 2 } as const;
  const candidates = automations
    .filter((a) => a.is_active && a.channel_id === comment.channelId)
    .map((a) => ({ a, config: parseConfig(a.config) }))
    .sort((x, y) => rank[x.config.postMode] - rank[y.config.postMode]);

  for (const { a, config } of candidates) {
    if (!textMatches(config, comment.text)) continue;
    const post = postMatches(config, comment);
    if (post === true) return { automation: a, needsNextPostCheck: false };
    if (post === "check-next") return { automation: a, needsNextPostCheck: true };
  }
  return null;
}

export function pickRandom<T>(items: T[]): T | undefined {
  if (!items.length) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

/** `buttonId` set -> this specific opening-DM button, routed to its own
 * followUp on tap. Omitted -> the legacy single-button flow (top-level
 * linkDm). */
export function buttonPayload(automationId: string, buttonId?: string) {
  return buttonId ? `ctd:${automationId}:${buttonId}` : `ctd:${automationId}`;
}

export function parseButtonPayload(
  payload: string | undefined | null
): { automationId: string; buttonId: string | null } | null {
  if (!payload?.startsWith("ctd:")) return null;
  const rest = payload.slice(4);
  const sep = rest.indexOf(":");
  const automationId = sep === -1 ? rest : rest.slice(0, sep);
  const buttonId = sep === -1 ? null : rest.slice(sep + 1) || null;
  if (!/^[0-9a-f-]{36}$/i.test(automationId)) return null;
  return { automationId, buttonId };
}

export function validLinkButtons(buttons: LinkButton[]) {
  return buttons
    .filter((b) => b.label.trim() && /^https?:\/\//i.test(b.url.trim()))
    .slice(0, 3)
    .map((b) => ({ type: "url" as const, title: b.label.trim().slice(0, 20), url: b.url.trim() }));
}

