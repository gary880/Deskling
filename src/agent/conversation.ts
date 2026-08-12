export type ConversationEventType = "started" | "text" | "completed" | "error";

export interface ConversationEvent {
  requestId: string;
  purpose?: "conversation" | "proactive";
  type: ConversationEventType;
  text?: string;
}

export type ConversationStatus = "idle" | "thinking" | "talking" | "completed" | "error";

export interface ConversationHistoryEntry {
  id: string;
  role: "user" | "pet";
  content: string;
  source: "direct" | "proactive";
  createdAt: number;
}

export interface ConversationHistorySettings {
  saveHistory: boolean;
  retentionDays: number;
  maxEntries: number;
}

export const DEFAULT_HISTORY_SETTINGS: ConversationHistorySettings = {
  saveHistory: true,
  retentionDays: 30,
  maxEntries: 200,
};

export interface ConversationKeyState {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
  millisecondsSinceCompositionEnd?: number;
}

export function shouldSubmitConversationKey(state: ConversationKeyState): boolean {
  return state.key === "Enter"
    && !state.shiftKey
    && !state.isComposing
    && state.keyCode !== 229
    && (state.millisecondsSinceCompositionEnd === undefined || state.millisecondsSinceCompositionEnd > 80);
}

export function statusFromEvent(event: ConversationEvent): ConversationStatus {
  if (event.type === "started") return "thinking";
  if (event.type === "text") return "talking";
  return event.type;
}
