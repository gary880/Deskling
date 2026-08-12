import { describe, expect, it } from "vitest";
import { statusFromEvent } from "./conversation";

describe("statusFromEvent", () => {
  it("maps runtime events to pet conversation states", () => {
    expect(statusFromEvent({ requestId: "1", type: "started" })).toBe("thinking");
    expect(statusFromEvent({ requestId: "1", type: "text", text: "hi" })).toBe("talking");
    expect(statusFromEvent({ requestId: "1", type: "completed" })).toBe("completed");
    expect(statusFromEvent({ requestId: "1", type: "error" })).toBe("error");
  });
});
