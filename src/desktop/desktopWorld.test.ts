import { describe, expect, it } from "vitest";
import {
  desktopFloorFeetPosition,
  feetAnchorOffset,
  windowSnapshotChanged,
  windowRoamFeetTarget,
  windowTopFeetPosition,
  type DesktopWindowSnapshot,
  type FeetAnchorMetrics,
} from "./desktopWorld";

const metrics: FeetAnchorMetrics = {
  overlayWidth: 320,
  overlayHeight: 300,
  frameWidth: 181,
  frameHeight: 181,
  feet: [91, 176],
  scale: 1,
  facing: "right",
  avatarBottom: 16,
};

const snapshot: DesktopWindowSnapshot = {
  appId: "pid:42",
  bounds: { x: -1400, y: 80, width: 1000, height: 700 },
  minimized: false,
  monitorId: "2",
};

describe("feet anchor positioning", () => {
  it("aligns the actual feet anchor with the active window top edge", () => {
    const anchor = feetAnchorOffset(metrics);
    const position = windowTopFeetPosition(snapshot, metrics);

    expect(position.x + anchor.x).toBe(snapshot.bounds.x + snapshot.bounds.width / 2);
    expect(position.y + anchor.y).toBe(snapshot.bounds.y);
  });

  it("preserves a preferred horizontal landing point instead of forcing the center", () => {
    const anchor = feetAnchorOffset(metrics);
    const position = windowTopFeetPosition(snapshot, metrics, -1250);

    expect(position.x + anchor.x).toBe(-1250);
    expect(position.x + anchor.x).not.toBe(snapshot.bounds.x + snapshot.bounds.width / 2);
  });

  it("keeps the feet on the valid portion of the window top edge", () => {
    const anchor = feetAnchorOffset(metrics);

    expect(windowTopFeetPosition(snapshot, metrics, -2000).x + anchor.x).toBe(-1376);
    expect(windowTopFeetPosition(snapshot, metrics, 0).x + anchor.x).toBe(-424);
  });

  it("aligns the feet with a desktop floor on a negative-coordinate monitor", () => {
    const anchor = feetAnchorOffset(metrics);
    const position = desktopFloorFeetPosition(-1200, {
      x: -1920,
      y: 0,
      width: 1920,
      height: 1080,
    }, metrics);

    expect(position.x).toBe(-1200);
    expect(position.y + anchor.y).toBe(1080);
  });

  it("mirrors a non-centered feet anchor with the sprite facing", () => {
    expect(feetAnchorOffset({ ...metrics, feet: [40, 176], facing: "left" }).x).toBe(
      metrics.overlayWidth - (metrics.overlayWidth - metrics.frameWidth) / 2 - 40,
    );
  });
});

describe("windowSnapshotChanged", () => {
  it("ignores sub-tolerance coordinate noise", () => {
    expect(windowSnapshotChanged(snapshot, {
      ...snapshot,
      bounds: { ...snapshot.bounds, x: snapshot.bounds.x + 1.5, height: 699 },
    })).toBe(false);
  });

  it("detects active app, monitor, and meaningful geometry changes", () => {
    expect(windowSnapshotChanged(snapshot, { ...snapshot, appId: "pid:43" })).toBe(true);
    expect(windowSnapshotChanged(snapshot, { ...snapshot, monitorId: "3" })).toBe(true);
    expect(windowSnapshotChanged(snapshot, {
      ...snapshot,
      bounds: { ...snapshot.bounds, width: snapshot.bounds.width + 3 },
    })).toBe(true);
  });
});

describe("windowRoamFeetTarget", () => {
  it("keeps autonomous roaming on the active window top edge", () => {
    expect(windowRoamFeetTarget(snapshot, -1200)).toBe(-424);
    expect(windowRoamFeetTarget(snapshot, -500)).toBe(-1376);
  });
});
