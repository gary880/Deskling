import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ConversationStatus } from "../agent/conversation";

interface PetConversationCardProps {
  petName: string;
  response: string;
  status: ConversationStatus;
  runtimeAvailable: boolean;
  onClose: () => void;
  onSend: (message: string) => Promise<void>;
  onStop: () => Promise<void>;
}

export function PetConversationCard({
  petName, response, status, runtimeAvailable, onClose, onSend, onStop,
}: PetConversationCardProps) {
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "thinking" || status === "talking";

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = message.trim();
    if (!value || busy || !runtimeAvailable) return;
    setMessage("");
    await onSend(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section className="pet-conversation" aria-label={`與 ${petName} 對話`} onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <div><span className={`pet-conversation__dot pet-conversation__dot--${status}`} /><strong>{petName}</strong></div>
        <button type="button" aria-label="關閉對話" onClick={onClose}>×</button>
      </header>
      <div className="pet-conversation__response" aria-live="polite">
        {!runtimeAvailable
          ? "找不到 Codex CLI。請先安裝並登入 Codex，Pet 才能回答。"
          : response || (busy ? "讓我想想…" : "今天想和我聊什麼？")}
        {status === "talking" && <i aria-hidden="true" />}
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <textarea
          ref={inputRef}
          value={message}
          rows={2}
          maxLength={8000}
          disabled={busy || !runtimeAvailable}
          placeholder="直接問 Pet…"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy
          ? <button type="button" className="pet-conversation__stop" onClick={() => void onStop()}>停止</button>
          : <button type="submit" disabled={!message.trim() || !runtimeAvailable}>送出</button>}
      </form>
      <small>Codex · read-only</small>
    </section>
  );
}
