import { isTauri } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentActivity, AgentActivityEvent, AgentActivitySource } from "../behavior/AgentActivity";
import type { AgentProvider, AgentProviderStatus, ConversationEvent, ConversationHistoryEntry, ConversationHistorySettings, ConversationOutputProfile } from "../agent/conversation";
import type { PetPersonalityOverride } from "../domain/avatar";
import type { PetMemory } from "../domain/petMemory";

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
  proactiveSettings: "deskling-proactive-settings",
  testProactive: "deskling-test-proactive",
  proactiveTestStatus: "deskling-proactive-test-status",
  historySettingsChanged: "deskling-history-settings-changed",
  conversationHistoryChanged: "deskling-conversation-history-changed",
  newConversation: "deskling-new-conversation",
  petCatalogChanged: "deskling-pet-catalog-changed",
  agentActivity: "deskling-agent-activity",
  conversation: "deskling-conversation-event",
  personalityChanged: "deskling-personality-changed",
  memoryChanged: "deskling-memory-changed",
  memorySettingsChanged: "deskling-memory-settings-changed",
  conversationUiState: "deskling-conversation-ui-state",
  conversationUiAction: "deskling-conversation-ui-action",
  agentProviderChanged: "deskling-agent-provider-changed",
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
  proactiveSettings: "deskling.proactiveSettings",
  conversationPositionOffset: "deskling.conversationPositionOffset",
  conversationHistorySettings: "deskling.conversationHistorySettings",
  petMemorySettings: "deskling.petMemorySettings",
  agentProvider: "deskling.agentProvider",
} as const;

export function readAgentProvider(): AgentProvider {
  return localStorage.getItem(DESKTOP_STORAGE.agentProvider) === "claude-code" ? "claude-code" : "codex";
}

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export interface InstalledPetDescriptor {
  id: string;
  baseDir: string;
  manifest?: unknown;
  petManifest?: unknown;
  extension?: unknown;
  frameCounts?: number[];
}

export async function choosePetZip(): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, directory: false, filters: [{ name: "Pet ZIP", extensions: ["zip"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function importPetZip(zipPath: string, replace = false): Promise<InstalledPetDescriptor> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<InstalledPetDescriptor>("import_pet_zip", { zipPath, replace });
}

export async function listInstalledPets(): Promise<InstalledPetDescriptor[]> {
  if (!isDesktopRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<InstalledPetDescriptor[]>("list_installed_pets");
}

export async function removeInstalledPet(id: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_installed_pet", { id });
}

export async function reportAgentActivity(
  activity: AgentActivity,
  source: AgentActivitySource = "manual",
  message?: string,
): Promise<AgentActivityEvent> {
  if (!isDesktopRuntime()) return { source, activity, message, timestamp: Date.now() };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentActivityEvent>("report_agent_activity", { source, activity, message });
}

export async function clearAgentActivity(): Promise<AgentActivityEvent> {
  if (!isDesktopRuntime()) return { source: "manual", activity: "idle", timestamp: Date.now() };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentActivityEvent>("clear_agent_activity");
}

export async function agentRuntimeAvailable(provider: AgentProvider = readAgentProvider()): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("agent_runtime_available", { provider });
}

export async function agentProviderStatuses(): Promise<AgentProviderStatus[]> {
  if (!isDesktopRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentProviderStatus[]>("agent_provider_statuses");
}

export async function startPetConversation(message: string, petName: string, petInstructions = "", purpose: "conversation" | "proactive" = "conversation", approvedMemories: PetMemory[] = [], provider: AgentProvider = readAgentProvider(), outputProfile: ConversationOutputProfile = "default"): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("start_pet_conversation", { message, petName, petInstructions, purpose, approvedMemories, provider, outputProfile });
}

export async function loadPetMemory(petId: string, maxEntries: number): Promise<PetMemory[]> {
  if (!isDesktopRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PetMemory[]>("load_pet_memory", { petId, maxEntries });
}

export async function savePetMemory(petId: string, memory: PetMemory, maxEntries: number): Promise<PetMemory[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const items = await invoke<PetMemory[]>("save_pet_memory", { petId, memory, maxEntries });
  void Promise.allSettled([
    emitTo("pet", DESKTOP_EVENTS.memoryChanged, petId),
    emitTo("control", DESKTOP_EVENTS.memoryChanged, petId),
  ]);
  return items;
}

export async function deletePetMemory(petId: string, memoryId: string): Promise<PetMemory[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const items = await invoke<PetMemory[]>("delete_pet_memory", { petId, memoryId });
  void Promise.allSettled([
    emitTo("pet", DESKTOP_EVENTS.memoryChanged, petId),
    emitTo("control", DESKTOP_EVENTS.memoryChanged, petId),
  ]);
  return items;
}

export async function clearPetMemory(petId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_pet_memory", { petId });
  void Promise.allSettled([
    emitTo("pet", DESKTOP_EVENTS.memoryChanged, petId),
    emitTo("control", DESKTOP_EVENTS.memoryChanged, petId),
  ]);
}

export async function loadPetPersonality(petId: string): Promise<PetPersonalityOverride> {
  if (!isDesktopRuntime()) return {};
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PetPersonalityOverride>("load_pet_personality", { petId });
}

export async function savePetPersonality(petId: string, settings: PetPersonalityOverride): Promise<PetPersonalityOverride> {
  if (!isDesktopRuntime()) return settings;
  const { invoke } = await import("@tauri-apps/api/core");
  const saved = await invoke<PetPersonalityOverride>("save_pet_personality", { petId, settings });
  await emitTo("pet", DESKTOP_EVENTS.personalityChanged, { petId, settings: saved });
  return saved;
}

export async function resetPetPersonality(petId: string): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reset_pet_personality", { petId });
  await emitTo("pet", DESKTOP_EVENTS.personalityChanged, { petId, settings: {} });
}

export async function stopPetConversation(): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_pet_conversation");
}

export async function resetPetConversation(provider: AgentProvider = readAgentProvider()): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reset_pet_conversation", { provider });
}

export async function loadConversationHistory(petId: string, settings: ConversationHistorySettings): Promise<ConversationHistoryEntry[]> {
  if (!isDesktopRuntime() || !settings.saveHistory) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ConversationHistoryEntry[]>("load_conversation_history", { petId, retentionDays: settings.retentionDays, maxEntries: settings.maxEntries });
}

export async function appendConversationHistory(petId: string, entry: ConversationHistoryEntry, settings: ConversationHistorySettings): Promise<ConversationHistoryEntry[]> {
  if (!isDesktopRuntime() || !settings.saveHistory) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const entries = await invoke<ConversationHistoryEntry[]>("append_conversation_history", { petId, entry, retentionDays: settings.retentionDays, maxEntries: settings.maxEntries });
  await emitTo("control", DESKTOP_EVENTS.conversationHistoryChanged, petId);
  return entries;
}

export async function clearConversationHistory(petId: string): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_conversation_history", { petId });
  await emitTo("control", DESKTOP_EVENTS.conversationHistoryChanged, petId);
}

export type { ConversationEvent };

export async function emitToPet<T>(event: string, payload: T): Promise<void> {
  if (!isDesktopRuntime()) return;
  await emitTo("pet", event, payload);
}

export async function emitToConversation<T>(event: string, payload: T): Promise<void> {
  if (!isDesktopRuntime()) return;
  await emitTo("conversation", event, payload);
}

export async function emitToControl<T>(event: string, payload: T): Promise<void> {
  if (!isDesktopRuntime()) return;
  await emitTo("control", event, payload);
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
