import { useEffect, useMemo, useState } from "react";
import type { PetPackage } from "../domain/avatar";
import {
  adaptOpenPetsManifest,
  OPENPETS_ANIMATIONS,
  OPENPETS_COLUMNS,
  type DesklingExtension,
} from "../domain/openPets";
import { InvalidPetPackageError, validateDesklingExtension, validateManifest } from "../domain/validation";

interface Props {
  pkg: PetPackage;
  onImport: () => Promise<void>;
  importing: boolean;
}

const ROW_TO_SEMANTIC: Record<number, string[]> = {
  0: ["idle", "sleep", "look"],
  1: ["walk"],
  3: ["happy"],
  4: ["surprised"],
  5: ["annoyed"],
  6: ["thinking"],
  8: ["talking"],
};

function extensionFromPackage(pkg: PetPackage): DesklingExtension {
  const playback: NonNullable<DesklingExtension["playback"]> = {};
  for (const [rowText, semantics] of Object.entries(ROW_TO_SEMANTIC)) {
    const row = Number(rowText);
    const semantic = semantics.find((name) => pkg.manifest.animations[name]);
    const animation = semantic ? pkg.manifest.animations[semantic] : undefined;
    if (animation) playback[OPENPETS_ANIMATIONS[row]] = {
      frames: animation.frames,
      fps: animation.fps,
      loop: animation.loop,
    };
  }
  return {
    schemaVersion: 1,
    extends: { format: "openpets", profile: "codex-pets-8x9" },
    animationMap: {
      walk: { right: "running-right", left: "running-left" },
      thinking: "waiting",
      happy: "waving",
      annoyed: "failed",
      talking: "review",
    },
    playback,
    anchors: pkg.manifest.anchors,
    hitboxes: pkg.manifest.hitboxes,
    ...(pkg.manifest.sounds ? { sounds: pkg.manifest.sounds } : {}),
    ...(pkg.manifest.personality ? { personality: pkg.manifest.personality } : {}),
  };
}

export function PetCreator({ pkg, onImport, importing }: Props) {
  const [frame, setFrame] = useState(0);
  const [activeRow, setActiveRow] = useState(0);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<{ valid: boolean; message: string }>({
    valid: true,
    message: "Deskling sidecar valid",
  });
  const compatible = pkg.manifest.compatibilityProfile === "codex-pets-8x9";

  useEffect(() => {
    setSource(JSON.stringify(pkg.desklingExtension ?? extensionFromPackage(pkg), null, 2));
    setStatus({ valid: true, message: "Deskling sidecar valid" });
  }, [pkg]);

  useEffect(() => {
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % OPENPETS_COLUMNS), 160);
    return () => window.clearInterval(timer);
  }, []);

  const extension = useMemo(() => {
    try {
      return validateDesklingExtension(JSON.parse(source));
    } catch {
      return null;
    }
  }, [source]);

  const validate = (): DesklingExtension | null => {
    try {
      const value = validateDesklingExtension(JSON.parse(source));
      validateManifest(adaptOpenPetsManifest({
        id: pkg.manifest.id,
        displayName: pkg.manifest.name,
        description: pkg.manifest.description ?? "",
        spritesheetPath: pkg.manifest.renderer.asset,
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
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(source) as Record<string, unknown>; } catch { return; }
    const playback = (raw.playback && typeof raw.playback === "object" ? raw.playback : {}) as Record<string, Record<string, unknown>>;
    playback[name] = { ...(playback[name] ?? {}), [key]: value };
    raw.playback = playback;
    setSource(JSON.stringify(raw, null, 2));
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

  const frameWidth = pkg.manifest.renderer.frameWidth;
  const frameHeight = pkg.manifest.renderer.frameHeight;
  const previewScale = Math.min(0.42, 78 / frameHeight);

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
            <div className="creator-section-title"><span>DESKLING SIDECAR</span><small>animationMap · anchors · hitboxes · personality</small></div>
            <textarea value={source} spellCheck={false} onChange={(event) => setSource(event.target.value)} aria-label="deskling.json editor" />
            <div className={`creator-validation ${status.valid ? "valid" : "invalid"}`}><span>{status.valid ? "✓" : "!"}</span><p>{status.message}</p></div>
            <div className="creator-actions"><button type="button" onClick={validate}>Validate</button><button type="button" className="creator-export" onClick={download}>Export deskling.json</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
