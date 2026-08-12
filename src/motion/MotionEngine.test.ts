import { describe, expect, it } from "vitest";
import { MotionEngine } from "./MotionEngine";

describe("MotionEngine", () => {
  it("moves independently from avatar animation", () => {
    const motion = new MotionEngine({ x: 0, y: 0 }, 100);
    motion.moveTo({ x: 50, y: 0 });
    expect(motion.step(0.25)).toMatchObject({ position: { x: 25, y: 0 }, moving: true });
    expect(motion.step(0.25)).toMatchObject({ position: { x: 50, y: 0 }, moving: false });
  });

  it("preserves facing after arriving", () => {
    const motion = new MotionEngine({ x: 100, y: 0 }, 100);
    motion.moveTo({ x: 0, y: 0 });
    motion.step(0.5);
    motion.step(0.5);
    expect(motion.getSnapshot().facing).toBe("left");
  });
});
