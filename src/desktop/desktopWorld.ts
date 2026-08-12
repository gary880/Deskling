import { invoke } from "@tauri-apps/api/core";
import type { Facing, Point, Rect } from "../domain/avatar";
import { isDesktopRuntime } from "./bridge";

export type AccessibilityPermissionStatus = "authorized" | "denied" | "unsupported";

export interface DesktopWindowSnapshot {
  appId: string;
  title?: string;
  bounds: Rect;
  minimized: boolean;
  monitorId: string;
}

export interface FeetAnchorMetrics {
  overlayWidth: number;
  overlayHeight: number;
  frameWidth: number;
  frameHeight: number;
  feet: readonly [number, number];
  scale: number;
  facing: Facing;
  avatarBottom: number;
}

export interface DesktopPosition extends Point {}

export const WINDOW_TRACKING_INTERVAL_MS = 125;
export const WINDOW_COORDINATE_TOLERANCE = 2;
export const WINDOW_EDGE_INSET = 24;

export async function getAccessibilityPermissionStatus(): Promise<AccessibilityPermissionStatus> {
  if (!isDesktopRuntime()) return "unsupported";
  return invoke<AccessibilityPermissionStatus>("accessibility_permission_status");
}

export async function requestAccessibilityPermission(): Promise<AccessibilityPermissionStatus> {
  if (!isDesktopRuntime()) return "unsupported";
  return invoke<AccessibilityPermissionStatus>("request_accessibility_permission");
}

export async function openAccessibilitySettings(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  return invoke<boolean>("open_accessibility_settings");
}

export async function getActiveDesktopWindow(): Promise<DesktopWindowSnapshot | null> {
  if (!isDesktopRuntime()) return null;
  return invoke<DesktopWindowSnapshot | null>("active_desktop_window");
}

export async function positionPetWindow(position: DesktopPosition): Promise<void> {
  if (!isDesktopRuntime()) return;
  await invoke("position_pet_window", position);
}

export function windowSnapshotChanged(
  previous: DesktopWindowSnapshot | null,
  next: DesktopWindowSnapshot,
  tolerance = WINDOW_COORDINATE_TOLERANCE,
): boolean {
  if (!previous) return true;
  if (
    previous.appId !== next.appId ||
    previous.monitorId !== next.monitorId ||
    previous.minimized !== next.minimized
  ) {
    return true;
  }

  return (Object.keys(next.bounds) as (keyof Rect)[]).some(
    (key) => Math.abs(next.bounds[key] - previous.bounds[key]) > tolerance,
  );
}

export function feetAnchorOffset(metrics: FeetAnchorMetrics): Point {
  const sourceFeetX =
    metrics.facing === "left" ? metrics.frameWidth - metrics.feet[0] : metrics.feet[0];
  const avatarLeft = (metrics.overlayWidth - metrics.frameWidth * metrics.scale) / 2;
  const avatarTop =
    metrics.overlayHeight - metrics.avatarBottom - metrics.frameHeight * metrics.scale;
  return {
    x: avatarLeft + sourceFeetX * metrics.scale,
    y: avatarTop + metrics.feet[1] * metrics.scale,
  };
}

export function windowTopFeetPosition(
  snapshot: DesktopWindowSnapshot,
  metrics: FeetAnchorMetrics,
  preferredFeetX = snapshot.bounds.x + snapshot.bounds.width / 2,
): DesktopPosition {
  const anchor = feetAnchorOffset(metrics);
  const inset = Math.min(WINDOW_EDGE_INSET, snapshot.bounds.width / 2);
  const feetX = Math.min(
    Math.max(preferredFeetX, snapshot.bounds.x + inset),
    snapshot.bounds.x + snapshot.bounds.width - inset,
  );
  return {
    x: feetX - anchor.x,
    y: snapshot.bounds.y - anchor.y,
  };
}

export function windowRoamFeetTarget(
  snapshot: DesktopWindowSnapshot,
  currentFeetX: number,
): number {
  const inset = Math.min(WINDOW_EDGE_INSET, snapshot.bounds.width / 2);
  const left = snapshot.bounds.x + inset;
  const right = snapshot.bounds.x + snapshot.bounds.width - inset;
  return currentFeetX < (left + right) / 2 ? right : left;
}

export function desktopFloorFeetPosition(
  currentX: number,
  workArea: Rect,
  metrics: FeetAnchorMetrics,
): DesktopPosition {
  const anchor = feetAnchorOffset(metrics);
  const minimumX = workArea.x;
  const maximumX = Math.max(minimumX, workArea.x + workArea.width - metrics.overlayWidth);
  return {
    x: Math.round(Math.min(Math.max(currentX, minimumX), maximumX)),
    y: Math.round(workArea.y + workArea.height - anchor.y),
  };
}
