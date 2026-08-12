import { describe, expect, it } from "vitest";
import { BehaviorEngine, transitionSurface } from "./BehaviorEngine";

describe("BehaviorEngine", () => {
  it("enforces dragging > reacting > roaming > sleeping > idle", () => {
    const engine = new BehaviorEngine();
    expect(engine.state).toBe("idle");
    expect(engine.dispatch("sleepRequested")).toBe("sleeping");
    expect(engine.dispatch("wakeRequested")).toBe("idle");
    expect(engine.dispatch("roamRequested")).toBe("roaming");
    expect(engine.dispatch("reactionStarted")).toBe("reacting");
    expect(engine.dispatch("dragStarted")).toBe("dragging");
    expect(engine.dispatch("dragEnded")).toBe("reacting");
    expect(engine.dispatch("reactionCompleted")).toBe("idle");
  });

  it("keeps higher priority states active while deferring sleep and rejecting roam", () => {
    const engine = new BehaviorEngine();
    engine.dispatch("dragStarted");
    expect(engine.dispatch("sleepRequested")).toBe("dragging");
    expect(engine.dispatch("roamRequested")).toBe("dragging");
    expect(engine.dispatch("dragEnded")).toBe("sleeping");
    engine.dispatch("wakeRequested");
    engine.dispatch("reactionStarted");
    expect(engine.dispatch("roamRequested")).toBe("reacting");
  });

  it("keeps surface state independent from behavior state", () => {
    const engine = new BehaviorEngine();
    engine.dispatchSurface("windowTargetChanged");
    engine.dispatch("sleepRequested");

    expect(engine.surface).toBe("window");
    expect(engine.state).toBe("sleeping");
    expect(engine.snapshot).not.toHaveProperty("windowFollowing");
  });
});

describe("transitionSurface", () => {
  it("falls back to the desktop floor or manual placement when a target is lost", () => {
    expect(transitionSurface("window", "windowTargetLost", true)).toBe("desktopFloor");
    expect(transitionSurface("window", "windowTargetLost", false)).toBe("manual");
  });
});
