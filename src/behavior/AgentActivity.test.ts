import { describe, expect, it } from "vitest";
import { AgentActivityEngine } from "./AgentActivity";

describe("AgentActivityEngine", () => {
  it("accepts current activity and clears on idle", () => {
    const engine = new AgentActivityEngine();
    expect(engine.accept({ source: "codex", activity: "thinking", timestamp: 10 })).toBe(true);
    expect(engine.event?.activity).toBe("thinking");
    expect(engine.accept({ source: "codex", activity: "idle", timestamp: 11 })).toBe(true);
    expect(engine.event).toBeNull();
  });

  it("does not let stale events overwrite newer activity", () => {
    const engine = new AgentActivityEngine();
    engine.accept({ source: "codex", activity: "talking", timestamp: 20 });
    expect(engine.accept({ source: "codex", activity: "thinking", timestamp: 19 })).toBe(false);
    expect(engine.accept({ source: "codex", activity: "success", timestamp: 20 })).toBe(false);
    expect(engine.event?.activity).toBe("talking");
  });

  it("rejects invalid timestamps", () => {
    const engine = new AgentActivityEngine();
    expect(engine.accept({ source: "manual", activity: "success", timestamp: Number.NaN })).toBe(false);
    expect(engine.event).toBeNull();
  });
});
