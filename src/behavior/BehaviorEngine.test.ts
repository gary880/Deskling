import { describe, expect, it } from "vitest";
import { BehaviorEngine } from "./BehaviorEngine";

describe("BehaviorEngine", () => {
  it("enforces dragging > reacting > window following > roaming > sleeping > idle", () => {
    const engine = new BehaviorEngine();
    expect(engine.state).toBe("idle");
    expect(engine.setSignal("sleeping", true)).toBe("sleeping");
    expect(engine.setSignal("roaming", true)).toBe("roaming");
    expect(engine.setSignal("windowFollowing", true)).toBe("windowFollowing");
    expect(engine.setSignal("reacting", true)).toBe("reacting");
    expect(engine.setSignal("dragging", true)).toBe("dragging");
    expect(engine.setSignal("dragging", false)).toBe("reacting");
    expect(engine.setSignal("reacting", false)).toBe("windowFollowing");
  });

  it("accepts desktop-world input as a state signal, not a sprite row", () => {
    const engine = new BehaviorEngine();
    engine.setSignal("windowFollowing", true);
    expect(engine.state).toBe("windowFollowing");
    expect(engine.snapshot).not.toHaveProperty("animation");
  });
});
