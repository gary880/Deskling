import { PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  availableMonitors,
  primaryMonitor,
  type Monitor,
  type Window,
} from "@tauri-apps/api/window";
import { DESKTOP_STORAGE } from "./bridge";

interface SavedPosition {
  x: number;
  y: number;
}

export interface WorkAreaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowDimensions {
  width: number;
  height: number;
}

function parseSavedPosition(): SavedPosition | null {
  try {
    const value = JSON.parse(localStorage.getItem(DESKTOP_STORAGE.petPosition) ?? "null") as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "x" in value &&
      "y" in value &&
      typeof value.x === "number" &&
      typeof value.y === "number"
    ) {
      return { x: value.x, y: value.y };
    }
  } catch {
    // Invalid persisted state is ignored and replaced with a safe default.
  }
  return null;
}

function containsPoint(monitor: Monitor, point: SavedPosition): boolean {
  const { position, size } = monitor.workArea;
  return (
    point.x >= position.x &&
    point.y >= position.y &&
    point.x < position.x + size.width &&
    point.y < position.y + size.height
  );
}

export function clampPositionToWorkArea(
  position: SavedPosition,
  windowSize: WindowDimensions,
  workArea: WorkAreaBounds,
): SavedPosition {
  const maximumX = Math.max(workArea.x, workArea.x + workArea.width - windowSize.width);
  const maximumY = Math.max(workArea.y, workArea.y + workArea.height - windowSize.height);
  return {
    x: Math.round(Math.min(Math.max(position.x, workArea.x), maximumX)),
    y: Math.round(Math.min(Math.max(position.y, workArea.y), maximumY)),
  };
}

export function horizontalWalkTarget(
  currentX: number,
  windowWidth: number,
  workArea: WorkAreaBounds,
): number {
  const left = workArea.x;
  const right = Math.max(left, workArea.x + workArea.width - windowWidth);
  return currentX < (left + right) / 2 ? right : left;
}

function clampToMonitor(
  position: SavedPosition,
  windowSize: WindowDimensions,
  monitor: Monitor,
): SavedPosition {
  return clampPositionToWorkArea(position, windowSize, {
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
  });
}

async function chooseMonitor(position: SavedPosition | null): Promise<Monitor | null> {
  const monitors = await availableMonitors();
  if (position) {
    const matchingMonitor = monitors.find((monitor) => containsPoint(monitor, position));
    if (matchingMonitor) return matchingMonitor;
  }
  return (await primaryMonitor()) ?? monitors[0] ?? null;
}

export async function restorePetWindowPosition(window: Window): Promise<void> {
  const saved = parseSavedPosition();
  const monitor = await chooseMonitor(saved);
  if (!monitor) return;
  const windowSize = await window.outerSize();
  const fallback = {
    x: monitor.workArea.position.x + monitor.workArea.size.width - windowSize.width - 24,
    y: monitor.workArea.position.y + monitor.workArea.size.height - windowSize.height - 24,
  };
  const safe = clampToMonitor(saved ?? fallback, windowSize, monitor);
  await window.setPosition(new PhysicalPosition(safe.x, safe.y));
}

export async function constrainPetWindow(window: Window): Promise<void> {
  const position = await window.outerPosition();
  const monitor = await chooseMonitor(position);
  if (!monitor) return;
  const safe = clampToMonitor(position, await window.outerSize(), monitor);
  if (safe.x !== position.x || safe.y !== position.y) {
    await window.setPosition(new PhysicalPosition(safe.x, safe.y));
  }
}

export function persistPetWindowPosition(position: SavedPosition): void {
  localStorage.setItem(DESKTOP_STORAGE.petPosition, JSON.stringify(position));
}
