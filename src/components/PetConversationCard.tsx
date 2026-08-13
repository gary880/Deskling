import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { shouldSubmitConversationKey, type ConversationStatus } from "../agent/conversation";
import type { PetMemoryCategory } from "../domain/petMemory";

interface PetConversationCardProps {
  petName: string;
  response: string;
  memoryCandidate?: string;
  side?: "left" | "right";
  onSideChange?: (side: "left" | "right") => void;
  onWindowDrag?: () => void;
  status: ConversationStatus;
  runtimeAvailable: boolean;
  providerLabel: string;
  onClose: () => void;
  onSend: (message: string) => Promise<void>;
  onStop: () => Promise<void>;
  onRemember?: (content: string, category: PetMemoryCategory) => void;
  memoryStatus?: string;
  layoutStatus?: string;
  onTypingChange?: (typing: boolean) => void;
}

export function PetConversationCard({
  petName, response, memoryCandidate, side = "left", onSideChange, onWindowDrag, status, runtimeAvailable, providerLabel, onClose, onSend, onStop, onRemember, memoryStatus, layoutStatus, onTypingChange,
}: PetConversationCardProps) {
  const [message, setMessage] = useState("");
  const [memoryDraft, setMemoryDraft] = useState<string | null>(null);
  const [memoryCategory, setMemoryCategory] = useState<PetMemoryCategory>("fact");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef<number | null>(null);
  const busy = status === "thinking" || status === "talking";

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 120);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = message ? `${Math.min(input.scrollHeight, 76)}px` : "38px";
  }, [message]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = message.trim();
    if (!value || busy || !runtimeAvailable) return;
    setMessage("");
    await onSend(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const endedAt = compositionEndedAtRef.current;
    if (shouldSubmitConversationKey({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: composingRef.current || event.nativeEvent.isComposing,
      keyCode: event.nativeEvent.keyCode,
      millisecondsSinceCompositionEnd: endedAt === null ? undefined : performance.now() - endedAt,
    })) {
      event.preventDefault();
      void submit();
    }
  };

  const beginWindowDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !onWindowDrag) return;
    const target = event.target;
    if (target instanceof Element && target.closest("nav")) return;
    event.preventDefault();
    onWindowDrag();
  };

  return (
    <section className={`pet-conversation pet-conversation--${side} ${memoryDraft !== null ? "pet-conversation--memory" : ""}`} aria-label={`與 ${petName} 對話`} onPointerDown={(event) => event.stopPropagation()}>
      <header className={onWindowDrag ? "pet-conversation__drag-handle" : undefined} title={onWindowDrag ? "拖曳以移動對話框" : undefined} onPointerDown={beginWindowDrag}>
        <div><span className={`pet-conversation__dot pet-conversation__dot--${status}`} /><strong>{petName}</strong><small>{providerLabel} · tools off</small></div>
        <nav aria-label="對話框位置"><button type="button" aria-label="將對話框移到左側" aria-pressed={side === "left"} onClick={() => onSideChange?.("left")}>←</button><button type="button" aria-label="將對話框移到右側" aria-pressed={side === "right"} onClick={() => onSideChange?.("right")}>→</button><button type="button" aria-label="關閉對話" onClick={onClose}>×</button></nav>
      </header>
      <div className="pet-conversation__response" aria-live="polite">
        {!runtimeAvailable
          ? `${providerLabel} 尚未就緒。請先安裝 CLI 並以訂閱帳號登入。`
          : response || (busy ? "讓我想想…" : "今天想和我聊什麼？")}
        {status === "talking" && <i aria-hidden="true" />}
      </div>
      {status !== "thinking" && status !== "talking" && status !== "error" && response && memoryCandidate?.trim() && onRemember && memoryDraft === null && <div className="pet-conversation__actions"><button type="button" className="pet-conversation__remember" onClick={() => { setMemoryCategory("fact"); setMemoryDraft(memoryCandidate.trim()); }}>＋ 記住資訊</button></div>}
      {memoryDraft === null && <form onSubmit={(event) => void submit(event)}>
        <textarea
          ref={inputRef}
          value={message}
          rows={1}
          maxLength={8000}
          disabled={busy || !runtimeAvailable}
          placeholder="直接問 Pet…"
          onChange={(event) => {
            event.target.style.height = "38px";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 76)}px`;
            setMessage(event.target.value);
            onTypingChange?.(Boolean(event.target.value));
          }}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; compositionEndedAtRef.current = performance.now(); }}
          onKeyDown={onKeyDown}
        />
        {busy
          ? <button type="button" className="pet-conversation__stop" onClick={() => void onStop()}>停止</button>
          : <button type="submit" disabled={!message.trim() || !runtimeAvailable}>送出</button>}
      </form>}
      {memoryDraft !== null && <div className="pet-conversation__memory-editor">
        <header><div><strong>新增記憶</strong><small>僅保存給 {petName}</small></div><span>{memoryDraft.length}/300</span></header>
        <textarea aria-label="記憶內容" rows={2} maxLength={300} value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} />
        <div className="pet-conversation__memory-controls"><select aria-label="記憶類別" value={memoryCategory} onChange={(event) => setMemoryCategory(event.target.value as PetMemoryCategory)}><option value="preference">偏好</option><option value="fact">資訊</option><option value="ongoing">進行中</option></select><div><button type="button" onClick={() => setMemoryDraft(null)}>取消</button><button type="button" disabled={!memoryDraft.trim()} onClick={() => { onRemember?.(memoryDraft.trim(), memoryCategory); setMemoryDraft(null); }}>保存</button></div></div>
      </div>}
      {memoryStatus && <div className="pet-conversation__memory-status" role="status">{memoryStatus}</div>}
      {layoutStatus && <div className="pet-conversation__layout-status" role="status">{layoutStatus}</div>}
    </section>
  );
}
