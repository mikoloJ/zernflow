import { describe, it, expect } from "vitest";
import {
  enrichWithAutomations,
  enrichWithLocal,
  fillAutomationTemplates,
  mapZernioMessage,
  sortChronologically,
  templateRegex,
} from "./inbox-messages";

describe("mapZernioMessage", () => {
  it("reads Zernio's field names (message, incoming/outgoing)", () => {
    const inbound = mapZernioMessage({ id: "1", message: "PT please", direction: "incoming", createdAt: "2026-06-17T11:06:00Z" }, "c1");
    expect(inbound.direction).toBe("inbound");
    expect(inbound.text).toBe("PT please");
    const outbound = mapZernioMessage({ id: "2", message: "Sent!", direction: "outgoing", createdAt: "2026-06-17T11:07:00Z", deliveryStatus: "read" }, "c1");
    expect(outbound.direction).toBe("outbound");
    expect(outbound.extra?.deliveryStatus).toBe("read");
    expect(outbound.status).toBe("delivered");
  });

  it("keeps media, story replies, unsends and failures", () => {
    const m = mapZernioMessage(
      {
        id: "3",
        direction: "incoming",
        attachments: [{ type: "image", url: "https://cdn/x.jpg" }, { type: "video" }],
        storyReply: true,
        isDeleted: true,
        deliveryStatus: "failed",
        deliveryError: { message: "Outside the 24 hour window" },
        reactions: [{ emoji: "❤️", fromMe: true }],
      },
      "c1",
    );
    expect(m.extra?.attachments).toEqual([
      { type: "image", url: "https://cdn/x.jpg", previewUrl: null, filename: null },
      { type: "video", url: undefined, previewUrl: null, filename: null },
    ]);
    expect(m.extra?.storyReply).toEqual({ url: null });
    expect(m.extra?.isDeleted).toBe(true);
    expect(m.extra?.deliveryError).toBe("Outside the 24 hour window");
    expect(m.extra?.reactions).toEqual([{ emoji: "❤️", fromMe: true }]);
  });
});

describe("unsupported messages", () => {
  it("flags messages with nothing to show", () => {
    expect(mapZernioMessage({ id: "9", direction: "outgoing", message: "" }, "c1").extra?.unsupported).toBe(true);
    expect(mapZernioMessage({ id: "9", direction: "outgoing", message: "hi" }, "c1").extra?.unsupported).toBe(false);
  });
});

describe("enrichment", () => {
  const out = (id: string, text: string, at: string) =>
    mapZernioMessage({ id, message: text, direction: "outgoing", createdAt: at }, "c1");

  it("attaches locally recorded buttons to the matching send", () => {
    const [m] = enrichWithLocal(
      [out("1", "Pick one:", "2026-06-17T11:00:30Z")],
      [
        {
          text: "Pick one:",
          created_at: "2026-06-17T11:00:00Z",
          sent_by_flow_id: "flow-1",
          sent_by_user_id: null,
          attachments: [{ type: "buttons", buttons: [{ title: "Courses", type: "postback" }] }],
        },
      ],
    );
    expect(m.extra?.buttons).toEqual([{ title: "Courses", type: "postback", url: undefined }]);
    expect(m.extra?.sentBy).toBe("flow");
  });

  it("recognises automation messages despite personalisation", () => {
    const msgs = enrichWithAutomations(
      [out("1", "Hey Ada! Tap below", "2026-06-17T11:00:00Z"), out("2", "Here you go 👇", "2026-06-17T11:01:00Z")],
      [
        {
          name: "PT launch",
          openingText: "Hey {{first_name}}! Tap below",
          openingButton: "I am ready!",
          linkText: "Here you go 👇",
          linkButtons: [{ label: "Enrol Now", url: "https://irep.ng/enrol" }],
        },
      ],
    );
    expect(msgs[0].extra?.buttons).toEqual([{ title: "I am ready!", type: "postback" }]);
    expect(msgs[0].extra?.automationName).toBe("PT launch");
    expect(msgs[1].extra?.buttons).toEqual([{ title: "Enrol Now", type: "url", url: "https://irep.ng/enrol" }]);
  });

  it("builds template regexes that ignore case and spacing", () => {
    expect(templateRegex("Hi {{first_name}}, welcome").test("hi ada, welcome")).toBe(true);
    expect(templateRegex("Hi {{first_name}}, welcome").test("bye ada")).toBe(false);
  });

  it("sorts oldest first", () => {
    const sorted = sortChronologically([out("b", "2", "2026-06-17T12:00:00Z"), out("a", "1", "2026-06-17T11:00:00Z")]);
    expect(sorted.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("fillAutomationTemplates", () => {
  const tpl = {
    name: "PT launch",
    openingText: "Hi {{first_name}}! PT starts soon",
    openingButton: "I am ready!",
    linkText: "Here you go",
    linkButtons: [{ label: "Enrol", url: "https://irep.ng" }],
  };
  it("rebuilds the opening card Meta returns as an empty template", () => {
    const m = mapZernioMessage(
      { id: "1", message: "", direction: "outgoing", createdAt: "2026-09-25T13:12:58Z", attachments: [{ type: "template" }] },
      "c1",
    );
    const [filled] = fillAutomationTemplates([m], [{ at: "2026-09-25T13:12:55Z", template: tpl, vars: { first_name: "Michael" } }]);
    expect(filled.text).toBe("Hi Michael! PT starts soon");
    expect(filled.extra?.buttons).toEqual([{ title: "I am ready!", type: "postback" }]);
    expect(filled.extra?.attachments).toEqual([]);
    expect(filled.extra?.sentBy).toBe("automation");
  });
  it("leaves messages alone when no automation ran nearby", () => {
    const m = mapZernioMessage({ id: "1", message: "", direction: "outgoing", createdAt: "2026-09-25T15:00:00Z" }, "c1");
    const [same] = fillAutomationTemplates([m], [{ at: "2026-09-25T13:12:55Z", template: tpl, vars: {} }]);
    expect(same.extra?.unsupported).toBe(true);
  });
});
