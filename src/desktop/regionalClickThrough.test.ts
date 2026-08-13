import { describe, expect, it } from "vitest";
import {
  clientPointFromPhysicalCursor,
  framePointFromClient,
  pointInsideBounds,
} from "./regionalClickThrough";

describe("regional click-through geometry", () => {
  it("converts physical screen coordinates into CSS client coordinates", () => {
    expect(clientPointFromPhysicalCursor(
      { x: 760, y: 500 },
      { x: 640, y: 320 },
      2,
    )).toEqual({ x: 60, y: 90 });
  });

  it("maps the rendered sprite bounds back to manifest frame coordinates", () => {
    expect(framePointFromClient(
      { x: 160, y: 175 },
      { left: 69.5, top: 103.5, width: 181, height: 181 },
      181,
      181,
    )).toEqual({ x: 90.5, y: 71.5 });
  });

  it("rejects transparent space outside the sprite and accepts bubble edges", () => {
    const bounds = { left: 80, top: 20, width: 160, height: 60 };
    expect(framePointFromClient({ x: 20, y: 20 }, bounds, 181, 181)).toBeNull();
    expect(pointInsideBounds({ x: 240, y: 80 }, bounds)).toBe(true);
  });
});
