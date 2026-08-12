import { describe, expect, it } from "vitest";
import { DEFAULT_PROACTIVE_SETTINGS, canStartProactiveInteraction, emptyProactiveHistory, formatProactiveUtterance, isQuietHour, recordProactiveAttempt, recordProactiveIgnored } from "./ProactiveInteractionScheduler";

const context = { conversationOpen: false, activeRequest: false, dragging: false, sleeping: false, userTyping: false, petVisible: true, idleMinutes: 42 };

describe("proactive interaction guardrails", () => {
  it("is opt-in and honors overnight quiet hours", () => {
    expect(canStartProactiveInteraction(DEFAULT_PROACTIVE_SETTINGS, context, emptyProactiveHistory(), new Date(2026, 1, 1, 14))).toBe(false);
    expect(isQuietHour(new Date(2026, 1, 1, 23), "22:00", "08:00")).toBe(true);
    expect(isQuietHour(new Date(2026, 1, 1, 12), "22:00", "08:00")).toBe(false);
  });

  it("requires every runtime condition and enforces daily limits", () => {
    const settings = { ...DEFAULT_PROACTIVE_SETTINGS, enabled: true, frequency: "often" as const, dailyLimit: 1 };
    const now = new Date(2026, 1, 1, 14);
    expect(canStartProactiveInteraction(settings, context, emptyProactiveHistory(), now)).toBe(true);
    const attempted = recordProactiveAttempt(emptyProactiveHistory(), now);
    expect(canStartProactiveInteraction(settings, context, attempted, new Date(now.getTime() + 31 * 60_000))).toBe(false);
    expect(canStartProactiveInteraction(settings, { ...context, userTyping: true }, emptyProactiveHistory(), now)).toBe(false);
  });

  it("backs off after two ignores and pauses for the day after three", () => {
    const now = new Date(2026, 1, 1, 14);
    let history = emptyProactiveHistory();
    history = recordProactiveIgnored(history, now);
    history = recordProactiveIgnored(history, now);
    expect(history.consecutiveIgnored).toBe(2);
    history = recordProactiveIgnored(history, now);
    expect(history.pausedUntilDay).toBe("2026-2-1");
  });

  it("keeps one complete short sentence and marks unavoidable truncation", () => {
    expect(formatProactiveUtterance("先休息一下吧！ 等你回來。" )).toBe("先休息一下吧！");
    expect(formatProactiveUtterance("很長".repeat(50))).toHaveLength(80);
    expect(formatProactiveUtterance("很長".repeat(50)).endsWith("…")).toBe(true);
  });
});
