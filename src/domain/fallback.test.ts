import { describe, expect, it } from "vitest";
import type { AnimationDefinition } from "./avatar";
import { resolveAnimation } from "./fallback";

const animation = (row: number): AnimationDefinition => ({ row, frames: 4, fps: 6, loop: true });

describe("resolveAnimation", () => {
  it("uses the requested animation when it exists", () => {
    expect(resolveAnimation("happy", { idle: animation(0), happy: animation(1) })).toBe("happy");
  });

  it("follows semantic fallback chains", () => {
    expect(resolveAnimation("annoyed", { idle: animation(0), surprised: animation(1) })).toBe(
      "surprised",
    );
    expect(resolveAnimation("thinking", { idle: animation(0), look: animation(1) })).toBe("look");
    expect(resolveAnimation("talking", { idle: animation(0), thinking: animation(1) })).toBe(
      "thinking",
    );
  });

  it("never crashes when idle is also missing", () => {
    expect(resolveAnimation("sleep", { custom: animation(0) })).toBe("custom");
  });
});
