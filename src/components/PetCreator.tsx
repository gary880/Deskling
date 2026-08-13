import { useEffect, useMemo, useState } from "react";
import type { PetPackage } from "../domain/avatar";
import {
  adaptOpenPetsManifest,
  OPENPETS_ANIMATIONS,
  OPENPETS_COLUMNS,
  type DesklingAnimationTarget,
  type DesklingExtension,
  type OpenPetsManifest,
  type OpenPetsAnimation,
} from "../domain/openPets";
import { createOpenPetsPackageZip, creatorPetFromPackage, extensionFromPackage } from "../domain/petCreator";
import { InvalidPetPackageError, validateDesklingExtension, validateManifest } from "../domain/validation";

interface Props {
  pkg: PetPackage;
  onImport: () => Promise<void>;
  importing: boolean;
}

const SEMANTICS = ["idle", "sleep", "thinking", "talking", "happy", "annoyed", "surprised", "energetic", "look"] as const;
const TRAITS = ["warmth", "energy", "humor", "directness", "verbosity"] as const;
const ANCHORS = ["feet", "head", "speechBubble"] as const;
const HITBOXES = ["body", "head"] as const;

export function PetCreator({ pkg, onImport, importing }: Props) {
  const [frame, setFrame] = useState(0);
  const [activeRow, setActiveRow] = useState(0);
  const [source, setSource] = useState("");
  const [petDraft, setPetDraft] = useState<OpenPetsManifest | null>(() => creatorPetFromPackage(pkg));
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<{ valid: boolean; message: string }>({
    valid: true,
    message: "Deskling sidecar valid",
  });
  const compatible = pkg.manifest.compatibilityProfile === "codex-pets-8x9";

  useEffect(() => {
    setSource(JSON.stringify(pkg.desklingExtension ?? extensionFromPackage(pkg), null, 2));
    setPetDraft(creatorPetFromPackage(pkg));
    setStatus({ valid: true, message: "Deskling sidecar valid" });
  }, [pkg]);

  useEffect(() => {
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % OPENPETS_COLUMNS), 160);
    return () => window.clearInterval(timer);
  }, []);

  const extension = useMemo(() => {
    try {
      const value = validateDesklingExtension(JSON.parse(source));
      validateManifest(adaptOpenPetsManifest(petDraft ?? {
        id: pkg.manifest.id, displayName: pkg.manifest.name,
        description: pkg.manifest.description ?? "", spritesheetPath: pkg.manifest.renderer.asset,
      }, { width: pkg.imageWidth, height: pkg.imageHeight }, value), {
        width: pkg.imageWidth,
        height: pkg.imageHeight,
      });
      return value;
    } catch {
      return null;
    }
  }, [petDraft, pkg, source]);

  const validate = (): DesklingExtension | null => {
    try {
      const value = validateDesklingExtension(JSON.parse(source));
      validateManifest(adaptOpenPetsManifest(petDraft ?? {
        id: pkg.manifest.id, displayName: pkg.manifest.name,
        description: pkg.manifest.description ?? "", spritesheetPath: pkg.manifest.renderer.asset,
      }, { width: pkg.imageWidth, height: pkg.imageHeight }, value), {
        width: pkg.imageWidth,
        height: pkg.imageHeight,
      });
      setStatus({ valid: true, message: "Deskling sidecar valid" });
      return value;
    } catch (error) {
      const message = error instanceof InvalidPetPackageError
        ? error.issues.join(" · ")
        : error instanceof Error ? error.message : String(error);
      setStatus({ valid: false, message });
      return null;
    }
  };

  const updatePlayback = (name: string, key: "frames" | "fps" | "loop", value: number | boolean) => {
    updateSource((raw) => {
      const playback = (raw.playback && typeof raw.playback === "object" ? raw.playback : {}) as Record<string, Record<string, unknown>>;
      playback[name] = { ...(playback[name] ?? {}), [key]: value };
      raw.playback = playback;
    });
  };

  const updateSource = (change: (raw: Record<string, unknown>) => void) => {
    try {
      const raw = JSON.parse(source) as Record<string, unknown>;
      change(raw);
      setSource(JSON.stringify(raw, null, 2));
      setStatus({ valid: true, message: "尚未驗證的變更" });
    } catch {
      setStatus({ valid: false, message: "請先修正 Advanced JSON 的語法" });
    }
  };

  const updateAnimationMap = (semantic: string, target: DesklingAnimationTarget) => {
    updateSource((raw) => {
      const map = (raw.animationMap && typeof raw.animationMap === "object" ? raw.animationMap : {}) as Record<string, DesklingAnimationTarget>;
      map[semantic] = target;
      raw.animationMap = map;
    });
  };

  const updateAnchor = (name: (typeof ANCHORS)[number], axis: 0 | 1, value: number) => {
    updateSource((raw) => {
      const anchors = (raw.anchors && typeof raw.anchors === "object" ? raw.anchors : {}) as Record<string, [number, number]>;
      const fallback = pkg.manifest.anchors[name];
      const point: [number, number] = [...(anchors[name] ?? fallback)];
      point[axis] = value;
      anchors[name] = point;
      raw.anchors = anchors;
    });
  };

  const updateHitbox = (name: (typeof HITBOXES)[number], key: "x" | "y" | "width" | "height", value: number) => {
    updateSource((raw) => {
      const hitboxes = (raw.hitboxes && typeof raw.hitboxes === "object" ? raw.hitboxes : {}) as Record<string, Record<string, number>>;
      hitboxes[name] = { ...(hitboxes[name] ?? pkg.manifest.hitboxes[name]), [key]: value };
      raw.hitboxes = hitboxes;
    });
  };

  const updatePersonality = (key: string, value: string | number) => {
    updateSource((raw) => {
      const personality = (raw.personality && typeof raw.personality === "object" ? raw.personality : {}) as Record<string, unknown>;
      if ((TRAITS as readonly string[]).includes(key)) {
        const traits = (personality.traits && typeof personality.traits === "object" ? personality.traits : {}) as Record<string, number>;
        traits[key] = value as number;
        personality.traits = traits;
      } else if (value === "") delete personality[key];
      else personality[key] = value;
      raw.personality = personality;
    });
  };

  const updatePet = (key: "id" | "displayName" | "description", value: string) => {
    setPetDraft((current) => current ? { ...current, [key]: value } : current);
    setStatus({ valid: true, message: "Package metadata 已更新；輸出前會再次驗證" });
  };

  const download = () => {
    const value = validate();
    if (!value) return;
    const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "deskling.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus({ valid: true, message: "deskling.json exported" });
  };

  const exportZip = async () => {
    const value = validate();
    if (!value) return;
    setExporting(true);
    setStatus({ valid: true, message: "正在收集 package assets…" });
    try {
      if (!petDraft) throw new Error("OpenPets metadata is unavailable");
      const archive = await createOpenPetsPackageZip(pkg, value, petDraft);
      const blob = new Blob([archive.buffer as ArrayBuffer], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${petDraft.id}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus({ valid: true, message: `${petDraft.id}.zip 已輸出，可直接重新匯入 Deskling` });
    } catch (error) {
      const message = error instanceof InvalidPetPackageError
        ? error.issues.join(" · ")
        : error instanceof Error ? error.message : String(error);
      setStatus({ valid: false, message });
    } finally {
      setExporting(false);
    }
  };

  const frameWidth = pkg.manifest.renderer.frameWidth;
  const frameHeight = pkg.manifest.renderer.frameHeight;
  const previewScale = Math.min(0.42, 78 / frameHeight);
  const geometryScale = Math.min(1, 230 / frameWidth, 230 / frameHeight);
  const anchors = extension?.anchors ?? pkg.manifest.anchors;
  const hitboxes = extension?.hitboxes ?? pkg.manifest.hitboxes;
  const personality = extension?.personality ?? {};
  const map = extension?.animationMap ?? {};

  return (
    <div className="pet-creator">
      <header className="creator-header">
        <div><span>DESKLING CREATOR</span><h2>{pkg.manifest.name}</h2><p>{pkg.manifest.description ?? pkg.manifest.id}</p></div>
        <button type="button" onClick={() => void onImport()} disabled={importing}>{importing ? "Importing…" : "Import OpenPets ZIP"}</button>
      </header>

      {!compatible ? (
        <div className="creator-empty"><strong>請匯入 OpenPets package</strong><p>Creator 需要 pet.json 與 8×9 spritesheet.webp。Legacy Deskling package 仍可在 Runtime 使用。</p></div>
      ) : (
        <div className="creator-body">
          <section className="creator-atlas">
            <div className="creator-section-title"><span>OPENPETS ATLAS</span><small>8 columns × 9 rows · click a row to preview</small></div>
            <div className="creator-rows">
              {OPENPETS_ANIMATIONS.map((name, row) => {
                const playback = extension?.playback?.[name];
                const frames = playback?.frames ?? pkg.atlasFrameCounts?.[row] ?? OPENPETS_COLUMNS;
                const previewFrame = activeRow === row ? frame % frames : 0;
                return (
                  <button type="button" className={activeRow === row ? "active" : ""} key={name} onClick={() => setActiveRow(row)}>
                    <span className="creator-row-number">{row}</span>
                    <i style={{
                      width: frameWidth * previewScale,
                      height: frameHeight * previewScale,
                      backgroundImage: `url(${pkg.assetUrl})`,
                      backgroundSize: `${pkg.imageWidth * previewScale}px ${pkg.imageHeight * previewScale}px`,
                      backgroundPosition: `${-previewFrame * frameWidth * previewScale}px ${-row * frameHeight * previewScale}px`,
                    }} />
                    <strong>{name}</strong>
                    <label>frames<input type="number" min="1" max="8" value={frames} onClick={(event) => event.stopPropagation()} onChange={(event) => updatePlayback(name, "frames", Math.max(1, Math.min(8, Number(event.target.value))))} /></label>
                    <label>fps<input type="number" min="1" max="60" value={playback?.fps ?? 6} onClick={(event) => event.stopPropagation()} onChange={(event) => updatePlayback(name, "fps", Math.max(1, Math.min(60, Number(event.target.value))))} /></label>
                    <label className="creator-loop"><input type="checkbox" checked={playback?.loop ?? true} onClick={(event) => event.stopPropagation()} onChange={(event) => updatePlayback(name, "loop", event.target.checked)} />loop</label>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="creator-json">
            <div className="creator-section-title"><span>DESKLING SETTINGS</span><small>visual editor · live geometry preview</small></div>
            <div className="creator-settings">
              {petDraft && <details open>
                <summary>Package metadata</summary>
                <div className="creator-metadata">
                  <label>Package ID<input value={petDraft.id} maxLength={64} pattern="[a-z0-9][a-z0-9-]*" onChange={(event) => updatePet("id", event.target.value.toLowerCase())} /><small>{pkg.source === "bundled" ? "內建角色會預設建立 -custom 副本" : "相同 ID 匯入時會要求確認替換"}</small></label>
                  <label>Display name<input value={petDraft.displayName} onChange={(event) => updatePet("displayName", event.target.value)} /></label>
                  <label className="creator-wide">Description<textarea value={petDraft.description} onChange={(event) => updatePet("description", event.target.value)} /></label>
                </div>
              </details>}
              <details open>
                <summary>Animation mapping</summary>
                <div className="creator-map-grid">
                  {SEMANTICS.map((semantic) => {
                    const target = map[semantic];
                    const selected = typeof target === "string" ? target : OPENPETS_ANIMATIONS[0];
                    return <label key={semantic}>{semantic}<select value={selected} onChange={(event) => updateAnimationMap(semantic, event.target.value as OpenPetsAnimation)}>{OPENPETS_ANIMATIONS.map((name) => <option key={name}>{name}</option>)}</select></label>;
                  })}
                  <label>walk right<select value={typeof map.walk === "object" ? map.walk.right : "running-right"} onChange={(event) => updateAnimationMap("walk", { right: event.target.value as OpenPetsAnimation, left: typeof map.walk === "object" ? map.walk.left : "running-left" })}>{OPENPETS_ANIMATIONS.map((name) => <option key={name}>{name}</option>)}</select></label>
                  <label>walk left<select value={typeof map.walk === "object" ? map.walk.left : "running-left"} onChange={(event) => updateAnimationMap("walk", { right: typeof map.walk === "object" ? map.walk.right : "running-right", left: event.target.value as OpenPetsAnimation })}>{OPENPETS_ANIMATIONS.map((name) => <option key={name}>{name}</option>)}</select></label>
                </div>
              </details>

              <details open>
                <summary>Anchors & hitboxes</summary>
                <div className="creator-geometry">
                  <div className="creator-geometry-preview" style={{ width: frameWidth * geometryScale, height: frameHeight * geometryScale }}>
                    <i style={{
                      backgroundImage: `url(${pkg.assetUrl})`,
                      backgroundSize: `${pkg.imageWidth * geometryScale}px ${pkg.imageHeight * geometryScale}px`,
                      backgroundPosition: `${-(frame % (extension?.playback?.[OPENPETS_ANIMATIONS[activeRow]]?.frames ?? pkg.atlasFrameCounts?.[activeRow] ?? OPENPETS_COLUMNS)) * frameWidth * geometryScale}px ${-activeRow * frameHeight * geometryScale}px`,
                    }} />
                    {HITBOXES.map((name) => <b key={name} className={`creator-hitbox creator-hitbox--${name}`} style={{ left: hitboxes[name].x * geometryScale, top: hitboxes[name].y * geometryScale, width: hitboxes[name].width * geometryScale, height: hitboxes[name].height * geometryScale }}>{name}</b>)}
                    {ANCHORS.map((name) => <span key={name} className={`creator-anchor creator-anchor--${name}`} style={{ left: anchors[name][0] * geometryScale, top: anchors[name][1] * geometryScale }} title={name} />)}
                  </div>
                  <div className="creator-geometry-fields">
                    {ANCHORS.map((name) => <fieldset key={name}><legend>{name}</legend>{(["x", "y"] as const).map((axis, index) => <label key={axis}>{axis}<input type="number" min="0" max={index === 0 ? frameWidth : frameHeight} value={anchors[name][index]} onChange={(event) => updateAnchor(name, index as 0 | 1, Number(event.target.value))} /></label>)}</fieldset>)}
                    {HITBOXES.map((name) => <fieldset key={name}><legend>{name} hitbox</legend>{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key}<input type="number" min={key === "width" || key === "height" ? 1 : 0} value={hitboxes[name][key]} onChange={(event) => updateHitbox(name, key, Number(event.target.value))} /></label>)}</fieldset>)}
                  </div>
                </div>
              </details>

              <details>
                <summary>Default personality</summary>
                <div className="creator-personality">
                  <label>Nickname<input value={personality.nickname ?? ""} maxLength={80} onChange={(event) => updatePersonality("nickname", event.target.value)} /></label>
                  <label>Language<select value={personality.preferredLanguage ?? "auto"} onChange={(event) => updatePersonality("preferredLanguage", event.target.value)}><option value="auto">Auto</option><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option></select></label>
                  <label className="creator-wide">Speaking style<input value={personality.speakingStyle ?? ""} maxLength={500} onChange={(event) => updatePersonality("speakingStyle", event.target.value)} /></label>
                  {TRAITS.map((trait) => <label key={trait}>{trait}<span><input type="range" min="0" max="100" value={personality.traits?.[trait] ?? 50} onChange={(event) => updatePersonality(trait, Number(event.target.value))} /><output>{personality.traits?.[trait] ?? 50}</output></span></label>)}
                  <label className="creator-wide">Custom instructions<textarea value={personality.customInstructions ?? ""} maxLength={2000} onChange={(event) => updatePersonality("customInstructions", event.target.value)} /></label>
                </div>
              </details>

              <details>
                <summary>Advanced JSON</summary>
                <textarea value={source} spellCheck={false} onChange={(event) => setSource(event.target.value)} aria-label="deskling.json editor" />
              </details>
            </div>
            <div className={`creator-validation ${status.valid ? "valid" : "invalid"}`}><span>{status.valid ? "✓" : "!"}</span><p>{status.message}</p></div>
            <div className="creator-actions"><button type="button" onClick={validate}>Validate</button><button type="button" onClick={download}>deskling.json</button><button type="button" className="creator-export" disabled={exporting} onClick={() => void exportZip()}>{exporting ? "Exporting…" : "Export installable ZIP"}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
