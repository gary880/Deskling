import { describe, expect, it } from "vitest";
import { clampPositionToWorkArea, horizontalWalkTarget } from "./windowPosition";

describe("clampPositionToWorkArea", () => {
  const windowSize = { width: 320, height: 300 };

  it("keeps an on-screen position unchanged", () => {
    expect(
      clampPositionToWorkArea({ x: 120, y: 80 }, windowSize, {
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
      }),
    ).toEqual({ x: 120, y: 80 });
  });

  it("constrains the pet to the usable monitor bounds", () => {
    expect(
      clampPositionToWorkArea({ x: 1400, y: 850 }, windowSize, {
        x: 0,
        y: 24,
        width: 1440,
        height: 876,
      }),
    ).toEqual({ x: 1120, y: 600 });
  });

  it("supports monitors positioned left of the primary display", () => {
    expect(
      clampPositionToWorkArea({ x: -2200, y: -50 }, windowSize, {
        x: -1920,
        y: 0,
        width: 1920,
        height: 1080,
      }),
    ).toEqual({ x: -1920, y: 0 });
  });
});

describe("horizontalWalkTarget", () => {
  const workArea = { x: -1920, y: 0, width: 1920, height: 1080 };

  it("walks toward the far edge of the current monitor", () => {
    expect(horizontalWalkTarget(-1700, 320, workArea)).toBe(-320);
    expect(horizontalWalkTarget(-500, 320, workArea)).toBe(-1920);
  });
});
