import { describe, expect, it } from "vitest";
import {
  NONSENSE_PRESENCE_BEATS,
  composeNonsensePresencePrompt,
  selectNonsensePresenceBeat,
} from "./NonsensePresenceBeats";

const context = {
  timeOfDay: "afternoon" as const,
  idleMinutes: 32,
  lastInteractionResult: "none" as const,
  behavior: "idle" as const,
  personality: { warmth: 80, energy: 65, humor: 70, directness: 45, verbosity: 30 },
};

describe("nonsense presence beats", () => {
  it("defines thirty unique AI premises", () => {
    expect(NONSENSE_PRESENCE_BEATS).toHaveLength(30);
    expect(new Set(NONSENSE_PRESENCE_BEATS.map((beat) => beat.id))).toHaveLength(30);
    expect(new Set(NONSENSE_PRESENCE_BEATS.map((beat) => beat.animation))).toEqual(
      new Set(["thinking", "talking", "happy", "surprised", "annoyed", "energetic", "look"]),
    );
  });

  it("selects deterministically and excludes recent beats", () => {
    const now = new Date(2026, 7, 13, 15);
    const selected = selectNonsensePresenceBeat(now, "mochi", 7);
    expect(selectNonsensePresenceBeat(now, "mochi", 7)).toEqual(selected);
    expect(selectNonsensePresenceBeat(now, "mochi", 7, [selected.id]).id).not.toBe(selected.id);
  });

  it("composes a constrained ambient prompt in the explicit target language", () => {
    const prompt = composeNonsensePresencePrompt(NONSENSE_PRESENCE_BEATS[0], context, "auto");
    expect(prompt).toContain("Traditional Chinese (zh-TW)");
    expect(prompt).toContain(NONSENSE_PRESENCE_BEATS[0].premise);
    expect(prompt).toContain("12 and 40 Unicode characters");
    expect(prompt).toContain("onomatopoeia");
    expect(prompt).toContain("Do not ask a question");
  });
});
