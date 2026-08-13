import type { Point } from "../domain/avatar";

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clientPointFromPhysicalCursor(
  cursor: Point,
  contentOrigin: Point,
  scaleFactor: number,
): Point {
  return {
    x: (cursor.x - contentOrigin.x) / scaleFactor,
    y: (cursor.y - contentOrigin.y) / scaleFactor,
  };
}

export function pointInsideBounds(point: Point, bounds: Bounds): boolean {
  return point.x >= bounds.left
    && point.x <= bounds.left + bounds.width
    && point.y >= bounds.top
    && point.y <= bounds.top + bounds.height;
}

export function framePointFromClient(
  point: Point,
  frameBounds: Bounds,
  frameWidth: number,
  frameHeight: number,
): Point | null {
  if (!pointInsideBounds(point, frameBounds) || frameBounds.width <= 0 || frameBounds.height <= 0) {
    return null;
  }
  return {
    x: ((point.x - frameBounds.left) / frameBounds.width) * frameWidth,
    y: ((point.y - frameBounds.top) / frameBounds.height) * frameHeight,
  };
}
