import { isTauri } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";

export const DESKTOP_EVENTS = {
  selectPet: "deskling-select-pet",
  playBehavior: "deskling-play-behavior",
  debug: "deskling-debug",
  clickThrough: "deskling-click-through",
  toggleClickThrough: "deskling-toggle-click-through",
  alwaysOnTop: "deskling-always-on-top",
  toggleAlwaysOnTop: "deskling-toggle-always-on-top",
  windowAware: "deskling-window-aware",
  toggleWindowAware: "deskling-toggle-window-aware",
  followActiveWindow: "deskling-follow-active-window",
  toggleFollowActiveWindow: "deskling-toggle-follow-active-window",
  desktopFloorFallback: "deskling-desktop-floor-fallback",
  toggleDesktopFloorFallback: "deskling-toggle-desktop-floor-fallback",
  accessibilityStatusChanged: "deskling-accessibility-status-changed",
  autonomySettings: "deskling-autonomy-settings",
} as const;

export const DESKTOP_STORAGE = {
  petId: "deskling.petId",
  petPosition: "deskling.petPosition",
  clickThrough: "deskling.clickThrough",
  alwaysOnTop: "deskling.alwaysOnTop",
  windowAware: "deskling.windowAware",
  followActiveWindow: "deskling.followActiveWindow",
  desktopFloorFallback: "deskling.desktopFloorFallback",
  autonomousBehavior: "deskling.autonomousBehavior",
  allowRoaming: "deskling.allowRoaming",
  sleepAfterMinutes: "deskling.sleepAfterMinutes",
  wakeOnWindowChange: "deskling.wakeOnWindowChange",
} as const;

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export async function emitToPet<T>(event: string, payload: T): Promise<void> {
  if (!isDesktopRuntime()) return;
  await emitTo("pet", event, payload);
}

export async function showPetWindow(): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await (await WebviewWindow.getByLabel("pet"))?.show();
}

export async function listenDesktop<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) return () => undefined;
  return listen<T>(event, ({ payload }) => handler(payload));
}

export function readBooleanSetting(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}

export function writeBooleanSetting(key: string, value: boolean): void {
  localStorage.setItem(key, String(value));
}

export function readNumberSetting<T extends number>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = Number(localStorage.getItem(key));
  return allowed.includes(value as T) ? value as T : fallback;
}

export function writeNumberSetting(key: string, value: number): void {
  localStorage.setItem(key, String(value));
}
