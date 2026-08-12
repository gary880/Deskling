import { describe, expect, it } from "vitest";
import { shouldSubmitConversationKey, statusFromEvent } from "./conversation";

describe("statusFromEvent", () => {
  it("maps runtime events to pet conversation states", () => {
    expect(statusFromEvent({ requestId: "1", type: "started" })).toBe("thinking");
    expect(statusFromEvent({ requestId: "1", type: "text", text: "hi" })).toBe("talking");
    expect(statusFromEvent({ requestId: "1", type: "completed" })).toBe("completed");
    expect(statusFromEvent({ requestId: "1", type: "error" })).toBe("error");
  });
});

describe("conversation keyboard input", () => {
  it("does not submit while an IME is composing or immediately after composition", () => {
    expect(shouldSubmitConversationKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSubmitConversationKey({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 })).toBe(false);
    expect(shouldSubmitConversationKey({ key: "Enter", shiftKey: false, isComposing: false, millisecondsSinceCompositionEnd: 20 })).toBe(false);
  });

  it("submits plain Enter but keeps Shift Enter for a newline", () => {
    expect(shouldSubmitConversationKey({ key: "Enter", shiftKey: false, isComposing: false, millisecondsSinceCompositionEnd: 100 })).toBe(true);
    expect(shouldSubmitConversationKey({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
  });
});
