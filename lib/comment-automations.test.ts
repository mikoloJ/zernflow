import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  keywordMatches,
  matchAutomation,
  parseButtonPayload,
  buttonPayload,
  interpolate,
  splitKeywords,
  type AutomationConfig,
  type CommentAutomationRow,
} from "./comment-automations";

function automation(
  id: string,
  config: Partial<AutomationConfig>,
  extra: Partial<CommentAutomationRow> = {},
): CommentAutomationRow {
  return {
    id,
    workspace_id: "ws",
    channel_id: "ch-ig",
    name: id,
    is_active: true,
    config: { ...DEFAULT_CONFIG, ...config } as never,
    comments_matched: 0,
    replies_posted: 0,
    opening_dms_sent: 0,
    button_taps: 0,
    link_dms_sent: 0,
    created_at: "2026-09-25T10:00:00Z",
    updated_at: "2026-09-25T10:00:00Z",
    ...extra,
  };
}

const comment = (text: string, postId = "post-1", platformPostId?: string) => ({
  channelId: "ch-ig",
  postId,
  platformPostId,
  text,
});

describe("keywordMatches", () => {
  it("matches whole words case-insensitively", () => {
    expect(keywordMatches("PT", "pt")).toBe(true);
    expect(keywordMatches("pt please!", "PT")).toBe(true);
    expect(keywordMatches("I want the PT course", "pt")).toBe(true);
    expect(keywordMatches("🔥PT🔥", "pt")).toBe(true);
  });
  it("does not match inside other words", () => {
    expect(keywordMatches("script", "pt")).toBe(false);
    expect(keywordMatches("optional", "pt")).toBe(false);
  });
  it("matches multi-word phrases", () => {
    expect(keywordMatches("send me the price list", "price list")).toBe(true);
  });
});

describe("matchAutomation", () => {
  it("matches a specific post by Zernio or platform id", () => {
    const a = automation("a", { postMode: "specific", postIds: ["1790"], keywords: ["PT"] });
    expect(matchAutomation([a], comment("pt", "zernio-x", "1790"))?.automation.id).toBe("a");
    expect(matchAutomation([a], comment("pt", "1790"))?.automation.id).toBe("a");
    expect(matchAutomation([a], comment("pt", "other"))).toBeNull();
  });

  it("requires the keyword unless mode is any word", () => {
    const specific = automation("s", { postMode: "any", keywords: ["PT"] });
    expect(matchAutomation([specific], comment("nice post"))).toBeNull();
    const any = automation("any", { postMode: "any", keywordMode: "any", keywords: [] });
    expect(matchAutomation([any], comment("nice post"))?.automation.id).toBe("any");
    expect(matchAutomation([any], comment("   "))).toBeNull();
  });

  it("prefers specific-post automations over catch-alls", () => {
    const catchAll = automation("all", { postMode: "any", keywords: ["PT"] });
    const targeted = automation("t", { postMode: "specific", postIds: ["post-1"], keywords: ["PT"] });
    expect(matchAutomation([catchAll, targeted], comment("PT"))?.automation.id).toBe("t");
    expect(matchAutomation([catchAll, targeted], comment("PT", "post-2"))?.automation.id).toBe("all");
  });

  it("ignores inactive automations and other channels", () => {
    const off = automation("off", { postMode: "any", keywords: ["PT"] }, { is_active: false });
    const fb = automation("fb", { postMode: "any", keywords: ["PT"] }, { channel_id: "ch-fb" });
    expect(matchAutomation([off, fb], comment("PT"))).toBeNull();
  });

  it("next-post mode asks for a lookup until a post is locked", () => {
    const next = automation("n", { postMode: "next", keywords: ["PT"] });
    expect(matchAutomation([next], comment("PT"))?.needsNextPostCheck).toBe(true);
    const locked = automation("n", { postMode: "next", keywords: ["PT"], lockedPostId: "post-9" });
    expect(matchAutomation([locked], comment("PT", "post-9"))?.needsNextPostCheck).toBe(false);
    expect(matchAutomation([locked], comment("PT", "post-1"))).toBeNull();
  });
});

describe("helpers", () => {
  it("round-trips button payloads and rejects foreign ones", () => {
    const id = "3f1c2a9e-1b2c-4d5e-8f90-123456789abc";
    expect(parseButtonPayload(buttonPayload(id))).toBe(id);
    expect(parseButtonPayload("ctd:not-a-uuid")).toBeNull();
    expect(parseButtonPayload("GET_STARTED")).toBeNull();
    expect(parseButtonPayload(undefined)).toBeNull();
  });
  it("interpolates variables and blanks unknown ones", () => {
    expect(interpolate("Hi {{first_name}}! {{nope}}", { first_name: "Ada" })).toBe("Hi Ada! ");
  });
  it("splits comma-separated keywords", () => {
    expect(splitKeywords(" PT, pt course ,, Price")).toEqual(["PT", "pt course", "Price"]);
  });
});
