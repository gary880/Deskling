import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_HISTORY_SETTINGS, type ConversationHistoryEntry, type ConversationHistorySettings } from "../agent/conversation";
import { clearConversationHistory, DESKTOP_EVENTS, DESKTOP_STORAGE, emitToPet, isDesktopRuntime, listenDesktop, loadConversationHistory, resetPetConversation } from "../desktop/bridge";

interface Props { petId: string; petName: string }

export function ConversationHistorySettings({ petId, petName }: Props) {
  const storageKey = `${DESKTOP_STORAGE.conversationHistorySettings}.${petId}`;
  const [settings, setSettings] = useState<ConversationHistorySettings>(DEFAULT_HISTORY_SETTINGS);
  const [entries, setEntries] = useState<ConversationHistoryEntry[]>([]);
  const [status, setStatus] = useState("");
  const settingsRef = useRef(settings);
  const refresh = useCallback((next: ConversationHistorySettings) => {
    void loadConversationHistory(petId, next).then(setEntries).catch((error) => setStatus(String(error)));
  }, [petId]);

  useEffect(() => {
    let next = DEFAULT_HISTORY_SETTINGS;
    try { next = { ...next, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}") }; } catch { /* defaults */ }
    setSettings(next);
    settingsRef.current = next;
    refresh(next);
    let unlisten: () => void = () => undefined;
    void listenDesktop<string>(DESKTOP_EVENTS.conversationHistoryChanged, (changedPetId) => {
      if (changedPetId === petId) refresh(settingsRef.current);
    }).then((value) => { unlisten = value; });
    return () => unlisten();
  }, [petId, refresh, storageKey]);

  const update = (next: ConversationHistorySettings) => {
    setSettings(next);
    settingsRef.current = next;
    localStorage.setItem(storageKey, JSON.stringify(next));
    void emitToPet(DESKTOP_EVENTS.historySettingsChanged, { petId, settings: next });
    if (next.saveHistory) refresh(next);
    setStatus(next.saveHistory ? "已儲存" : "已停止寫入新紀錄");
  };

  return <div className="history-lab">
    <p className="eyebrow">HISTORY</p>
    <label className="debug-toggle"><span><strong>保存對話</strong><small>僅保存在本機 App Data</small></span><input type="checkbox" checked={settings.saveHistory} disabled={!isDesktopRuntime()} onChange={(e) => update({ ...settings, saveHistory: e.target.checked })} /><i aria-hidden="true" /></label>
    <label className="select-setting"><span><strong>保存期限</strong><small>Retention</small></span><select value={settings.retentionDays} disabled={!settings.saveHistory} onChange={(e) => update({ ...settings, retentionDays: Number(e.target.value) })}><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="365">365 天</option></select></label>
    <label className="select-setting"><span><strong>最大筆數</strong><small>Per Pet</small></span><select value={settings.maxEntries} disabled={!settings.saveHistory} onChange={(e) => update({ ...settings, maxEntries: Number(e.target.value) })}><option value="50">50</option><option value="200">200</option><option value="500">500</option></select></label>
    <div className="history-lab__actions"><button type="button" onClick={() => void resetPetConversation().then(() => emitToPet(DESKTOP_EVENTS.newConversation, petId)).then(() => setStatus("已開始新對話 session"))}>New Conversation</button><button type="button" disabled={!entries.length} onClick={() => { if (!window.confirm(`清除 ${petName} 的所有本機對話紀錄？`)) return; void clearConversationHistory(petId).then(() => { setEntries([]); setStatus("歷史已清除"); }); }}>Clear History</button></div>
    <details className="history-lab__viewer"><summary>查看本機紀錄 ({entries.length})</summary><div>{entries.length ? entries.map((entry) => <article key={entry.id}><small>{entry.role === "user" ? "你" : petName}{entry.source === "proactive" ? " · 主動" : ""}</small><p>{entry.content}</p></article>) : <p>尚無保存的對話。</p>}</div></details>
    {status && <small className="personality-status">{status}</small>}
  </div>;
}
