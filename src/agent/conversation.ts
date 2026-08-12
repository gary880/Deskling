export type ConversationEventType = "started" | "text" | "completed" | "error";

export interface ConversationEvent {
  requestId: string;
  purpose?: "conversation" | "proactive";
  type: ConversationEventType;
  text?: string;
}

export type ConversationStatus = "idle" | "thinking" | "talking" | "completed" | "error";

export function statusFromEvent(event: ConversationEvent): ConversationStatus {
  if (event.type === "started") return "thinking";
  if (event.type === "text") return "talking";
  return event.type;
}
