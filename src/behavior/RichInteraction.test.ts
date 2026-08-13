import { describe, expect, it } from "vitest";
import { cursorNearHead, facingForCursor, PettingGestureTracker, reactionForInteraction } from "./RichInteraction";
import type { PetPersonality } from "../domain/avatar";

const personality = (traits: Partial<PetPersonality["traits"]> = {}, preferredLanguage: PetPersonality["preferredLanguage"] = "zh-TW"): PetPersonality => ({
  preferredLanguage,
  traits: { warmth: 60, energy: 50, humor: 40, directness: 55, verbosity: 35, ...traits },
});

describe("rich interaction reactions", () => {
  it("uses personality traits to choose local petting reactions", () => {
    expect(reactionForInteraction("petting", personality({ warmth: 90 })).animation).toBe("happy");
    expect(reactionForInteraction("petting", personality({ warmth: 20 })).animation).toBe("annoyed");
    expect(reactionForInteraction("head-tap", personality({ humor: 90 })).speech).toContain("髮型");
    expect(reactionForInteraction("body-tap", personality({ energy: 90 })).animation).toBe("surprised");
  });

  it("uses the explicitly preferred local language", () => {
    expect(reactionForInteraction("head-tap", personality({}, "en")).speech).toMatch(/[A-Za-z]/);
    expect(reactionForInteraction("head-tap", personality({}, "ja")).speech).toContain("なで");
  });
});

describe("cursor awareness", () => {
  it("detects the head attention radius and keeps facing stable in the center dead zone", () => {
    const head = { x: 90, y: 60 };
    expect(cursorNearHead({ x: 120, y: 70 }, head)).toBe(true);
    expect(cursorNearHead({ x: 160, y: 140 }, head)).toBe(false);
    expect(facingForCursor({ x: 40, y: 60 }, head, "right")).toBe("left");
    expect(facingForCursor({ x: 94, y: 60 }, head, "left")).toBe("left");
  });
});

describe("PettingGestureTracker", () => {
  it("requires deliberate back-and-forth movement over the head", () => {
    const tracker = new PettingGestureTracker();
    expect(tracker.record({ x: 50, y: 50 }, "head", 0)).toBe(false);
    expect(tracker.record({ x: 72, y: 51 }, "head", 100)).toBe(false);
    expect(tracker.record({ x: 48, y: 50 }, "head", 220)).toBe(false);
    expect(tracker.record({ x: 72, y: 52 }, "head", 340)).toBe(true);
  });

  it("does not treat a single pass or movement outside the head as petting", () => {
    const tracker = new PettingGestureTracker();
    tracker.record({ x: 40, y: 50 }, "head", 0);
    tracker.record({ x: 100, y: 50 }, "head", 400);
    expect(tracker.record({ x: 120, y: 50 }, "body", 500)).toBe(false);
    expect(tracker.record({ x: 40, y: 50 }, "head", 600)).toBe(false);
  });

  it("enforces a cooldown after recognition", () => {
    const tracker = new PettingGestureTracker({ cooldownMs: 1_000 });
    for (const [index, x] of [50, 72, 48, 72].entries()) tracker.record({ x, y: 50 }, "head", index * 120);
    expect(tracker.record({ x: 48, y: 50 }, "head", 500)).toBe(false);
    expect(tracker.record({ x: 72, y: 50 }, "head", 600)).toBe(false);
  });
});
