import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_MEMORY_SETTINGS, MEMORY_MAX_CONTENT_CHARS, sensitiveMemoryReason, type PetMemory, type PetMemoryCategory, type PetMemorySettings as Settings } from "../domain/petMemory";
import { clearPetMemory, deletePetMemory, DESKTOP_EVENTS, DESKTOP_STORAGE, emitToPet, isDesktopRuntime, listenDesktop, loadPetMemory, savePetMemory } from "../desktop/bridge";

interface Props { petId: string; petName: string }
const LABELS: Record<PetMemoryCategory, string> = { preference: "偏好", fact: "資訊", ongoing: "進行中" };

export function PetMemorySettings({ petId, petName }: Props) {
  const storageKey = `${DESKTOP_STORAGE.petMemorySettings}.${petId}`;
  const [settings, setSettings] = useState<Settings>(DEFAULT_MEMORY_SETTINGS);
  const [items, setItems] = useState<PetMemory[]>([]);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<PetMemoryCategory>("preference");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const settingsRef = useRef(settings);

  const refresh = useCallback((maxEntries: number) => {
    void loadPetMemory(petId, maxEntries).then(setItems).catch((error) => setStatus(String(error)));
  }, [petId]);

  useEffect(() => {
    let next = DEFAULT_MEMORY_SETTINGS;
    try { next = { ...next, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}") }; } catch { /* defaults */ }
    setSettings(next);
    settingsRef.current = next;
    refresh(next.maxEntries);
    let unlisten: () => void = () => undefined;
    void listenDesktop<string>(DESKTOP_EVENTS.memoryChanged, (changedPetId) => {
      if (changedPetId === petId) refresh(settingsRef.current.maxEntries);
    }).then((value) => { unlisten = value; });
    return () => unlisten();
  }, [petId, refresh, storageKey]);

  const updateSettings = (next: Settings) => {
    setSettings(next);
    settingsRef.current = next;
    localStorage.setItem(storageKey, JSON.stringify(next));
    void emitToPet(DESKTOP_EVENTS.memorySettingsChanged, { petId, settings: next });
    refresh(next.maxEntries);
    setStatus(next.enabled ? "Memory 已啟用" : "Memory 已停用；內容仍安全保留");
  };

  const submit = async () => {
    const value = content.trim();
    const reason = sensitiveMemoryReason(value);
    if (!value) return;
    if (reason) { setStatus(reason); return; }
    const existing = items.find((item) => item.id === editingId);
    const now = Date.now();
    const memory: PetMemory = { id: existing?.id ?? crypto.randomUUID(), category, content: value, createdAt: existing?.createdAt ?? now, updatedAt: now, sourceConversationId: existing?.sourceConversationId };
    try {
      setItems(await savePetMemory(petId, memory, settings.maxEntries));
      setContent(""); setEditingId(null); setStatus(existing ? "記憶已更新" : "記憶已新增");
    } catch (error) { setStatus(String(error)); }
  };

  return <div className="memory-lab">
    <p className="eyebrow">MEMORY</p>
    <label className="debug-toggle"><span><strong>允許使用記憶</strong><small>每隻 Pet 獨立；僅用於直接對話</small></span><input type="checkbox" checked={settings.enabled} disabled={!isDesktopRuntime()} onChange={(event) => updateSettings({ ...settings, enabled: event.target.checked })} /><i aria-hidden="true" /></label>
    <label className="select-setting"><span><strong>最大記憶數量</strong><small>Per Pet</small></span><select value={settings.maxEntries} onChange={(event) => updateSettings({ ...settings, maxEntries: Number(event.target.value) })}><option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select></label>
    <div className="memory-lab__editor">
      <select aria-label="記憶類別" value={category} onChange={(event) => setCategory(event.target.value as PetMemoryCategory)}><option value="preference">偏好</option><option value="fact">資訊</option><option value="ongoing">進行中</option></select>
      <textarea value={content} maxLength={MEMORY_MAX_CONTENT_CHARS} rows={3} placeholder="輸入你明確允許 Pet 記住的資訊…" onChange={(event) => setContent(event.target.value)} />
      <div><small>{content.length}/{MEMORY_MAX_CONTENT_CHARS}</small><button type="button" disabled={!content.trim() || !isDesktopRuntime()} onClick={() => void submit()}>{editingId ? "儲存修改" : "新增記憶"}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setContent(""); }}>取消</button>}</div>
    </div>
    <small className="privacy-note">禁止保存密碼、API token、私鑰、金融、政府身分與精確醫療資料。Package 作者不能要求保存資料。</small>
    <div className="memory-lab__list">{items.length ? [...items].reverse().map((item) => <article key={item.id}><header><strong>{LABELS[item.category]}</strong><small>{new Date(item.updatedAt).toLocaleString()}{item.sourceConversationId ? ` · 來源對話 ${item.sourceConversationId}` : " · 手動新增"}</small></header><p>{item.content}</p><div><button type="button" onClick={() => { setEditingId(item.id); setCategory(item.category); setContent(item.content); }}>編輯</button><button type="button" onClick={() => { if (!window.confirm("刪除這項記憶？")) return; void deletePetMemory(petId, item.id).then(setItems).catch((error) => setStatus(String(error))); }}>刪除</button></div></article>) : <p>尚無保存的記憶。</p>}</div>
    <button className="memory-lab__clear" type="button" disabled={!items.length} onClick={() => { if (!window.confirm(`清除 ${petName} 的所有記憶？此動作無法復原。`)) return; void clearPetMemory(petId).then(() => { setItems([]); setStatus("所有記憶已清除"); }); }}>Clear All Memory</button>
    {status && <small className="personality-status" role="status">{status}</small>}
  </div>;
}
