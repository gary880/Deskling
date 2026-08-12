import { useEffect, useMemo, useRef, useState } from "react";
import type { PetManifest, PetPersonalityOverride, PetPersonalityTraits, PreferredLanguage } from "../domain/avatar";
import { composePetInstructions, effectivePersonality } from "../domain/personality";
import { isDesktopRuntime, loadPetPersonality, resetPetPersonality, savePetPersonality } from "../desktop/bridge";

const TRAITS: { key: keyof PetPersonalityTraits; label: string; low: string; high: string }[] = [
  { key: "warmth", label: "溫暖程度", low: "冷淡", high: "溫暖" },
  { key: "energy", label: "活力", low: "安靜", high: "活潑" },
  { key: "humor", label: "幽默", low: "認真", high: "搞笑" },
  { key: "directness", label: "回答直接程度", low: "委婉", high: "直接" },
  { key: "verbosity", label: "回答長度", low: "簡短", high: "詳細" },
];

interface Props { manifest: PetManifest; preview: string; previewBusy: boolean; onPreview: (name: string, instructions: string) => Promise<void> }

export function PersonalitySettings({ manifest, preview, previewBusy, onPreview }: Props) {
  const [overrides, setOverrides] = useState<PetPersonalityOverride>({});
  const [status, setStatus] = useState("");
  const saveQueue = useRef(Promise.resolve());
  const effective = useMemo(() => effectivePersonality(manifest, overrides), [manifest, overrides]);
  useEffect(() => { let active = true; setStatus(""); void loadPetPersonality(manifest.id).then((v) => { if (active) setOverrides(v); }); return () => { active = false; }; }, [manifest.id]);
  const persist = async (next: PetPersonalityOverride) => { setOverrides(next); saveQueue.current = saveQueue.current.then(async () => { try { await savePetPersonality(manifest.id, next); setStatus(isDesktopRuntime() ? "已儲存" : "Web 預覽模式"); } catch (error) { setStatus(String(error)); } }); await saveQueue.current; };
  const updateText = (key: "nickname" | "speakingStyle" | "customInstructions", value: string) => void persist({ ...overrides, [key]: value || undefined });
  const reset = async () => { await saveQueue.current; await resetPetPersonality(manifest.id); setOverrides({}); setStatus("已還原 Pet 預設值"); };
  return <div className="personality-settings">
    <p className="eyebrow">PERSONALITY</p>
    <label className="personality-field"><span>暱稱</span><input value={overrides.nickname ?? ""} placeholder={manifest.name} maxLength={80} onChange={(e) => updateText("nickname", e.target.value)} /></label>
    {TRAITS.map(({ key, label, low, high }) => <label className="personality-trait" key={key}><span><strong>{label}</strong><b>{effective.traits[key]}</b></span><input type="range" min="0" max="100" value={effective.traits[key]} onChange={(e) => void persist({ ...overrides, traits: { ...overrides.traits, [key]: Number(e.target.value) } })} /><small><i>{low}</i><i>{high}</i></small></label>)}
    <label className="personality-field"><span>偏好語言</span><select value={effective.preferredLanguage} onChange={(e) => void persist({ ...overrides, preferredLanguage: e.target.value as PreferredLanguage })}><option value="auto">自動跟隨使用者</option><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option></select></label>
    <label className="personality-field"><span>自訂說話方式</span><textarea value={overrides.speakingStyle ?? ""} placeholder={manifest.personality?.speakingStyle ?? "描述自然的說話風格…"} maxLength={500} rows={3} onChange={(e) => updateText("speakingStyle", e.target.value)} /></label>
    <details className="personality-advanced"><summary>進階設定</summary><label className="personality-field"><span>額外偏好</span><textarea value={overrides.customInstructions ?? ""} maxLength={2000} rows={4} placeholder="只用來調整回應方式，無法改變權限或安全設定。" onChange={(e) => updateText("customInstructions", e.target.value)} /></label></details>
    <div className="personality-actions"><button type="button" onClick={() => void reset()}>Reset to Pet Default</button><button type="button" disabled={previewBusy || !isDesktopRuntime()} onClick={() => void onPreview(effective.nickname ?? manifest.name, composePetInstructions(manifest, overrides))}>{previewBusy ? "Thinking…" : "Preview Response"}</button></div>
    {status && <small className="personality-status">{status}</small>}
    <div className="personality-preview"><small>「今天工作有點累。」</small><p>{preview || "調整後可預覽 Pet 的回應。"}</p></div>
  </div>;
}
