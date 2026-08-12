import { useEffect, useState } from "react";
import type { ConversationStatus } from "../agent/conversation";
import { PetConversationCard } from "../components/PetConversationCard";
import type { PetMemoryCategory } from "../domain/petMemory";
import { DESKTOP_EVENTS, emitToPet, listenDesktop } from "./bridge";

export interface ConversationUiState {
  petName: string;
  response: string;
  memoryCandidate: string;
  status: ConversationStatus;
  runtimeAvailable: boolean;
  memoryStatus: string;
  side: "left" | "right";
}

export type ConversationUiAction =
  | { type: "close" }
  | { type: "send"; message: string }
  | { type: "stop" }
  | { type: "remember"; content: string; category: PetMemoryCategory }
  | { type: "side"; side: "left" | "right" }
  | { type: "typing"; typing: boolean };

const EMPTY_STATE: ConversationUiState = { petName: "Pet", response: "", memoryCandidate: "", status: "idle", runtimeAvailable: false, memoryStatus: "", side: "right" };

export function ConversationWindow() {
  const [state, setState] = useState(EMPTY_STATE);
  useEffect(() => {
    let active = true;
    let unlisten: () => void = () => undefined;
    void listenDesktop<ConversationUiState>(DESKTOP_EVENTS.conversationUiState, setState).then((value) => {
      if (active) unlisten = value;
      else value();
    });
    return () => { active = false; unlisten(); };
  }, []);
  const action = (payload: ConversationUiAction) => emitToPet(DESKTOP_EVENTS.conversationUiAction, payload);
  return <main className="conversation-window-shell"><PetConversationCard
    petName={state.petName} response={state.response} memoryCandidate={state.memoryCandidate}
    side={state.side} status={state.status} runtimeAvailable={state.runtimeAvailable} memoryStatus={state.memoryStatus}
    onClose={() => void action({ type: "close" })}
    onSend={async (message) => { await action({ type: "send", message }); }}
    onStop={async () => { await action({ type: "stop" }); }}
    onRemember={(content, category) => void action({ type: "remember", content, category })}
    onSideChange={(side) => void action({ type: "side", side })}
    onTypingChange={(typing) => void action({ type: "typing", typing })}
  /></main>;
}
