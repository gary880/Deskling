import type { AnimationDefinition, PetManifest, PetPersonalityOverride, Rect } from "./avatar";

export const OPENPETS_PROFILE = "codex-pets-8x9" as const;
export const OPENPETS_COLUMNS = 8;
export const OPENPETS_ROWS = 9;

export const OPENPETS_ANIMATIONS = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
] as const;

export type OpenPetsAnimation = (typeof OPENPETS_ANIMATIONS)[number];

export interface OpenPetsManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
}

export interface OpenPetsImageInfo {
  width: number;
  height: number;
  frameCounts?: number[];
}

export type DesklingAnimationTarget = OpenPetsAnimation | {
  right: OpenPetsAnimation;
  left: OpenPetsAnimation;
};

export interface DesklingExtension {
  schemaVersion: 1;
  extends?: { format: "openpets"; profile: typeof OPENPETS_PROFILE };
  animationMap?: Record<string, DesklingAnimationTarget>;
  playback?: Record<string, Partial<Pick<AnimationDefinition, "frames" | "fps" | "loop">>>;
  anchors?: PetManifest["anchors"];
  hitboxes?: PetManifest["hitboxes"];
  sounds?: Partial<Record<string, string>>;
  personality?: PetPersonalityOverride;
}

const DEFAULT_MAP: Record<string, DesklingAnimationTarget> = {
  idle: "idle",
  walk: { right: "running-right", left: "running-left" },
  sleep: "review",
  thinking: "waiting",
  talking: "running",
  happy: "waving",
  annoyed: "failed",
  surprised: "jumping",
  energetic: "jumping",
  look: "idle",
};

const DEFAULT_PLAYBACK: Record<OpenPetsAnimation, Pick<AnimationDefinition, "fps" | "loop">> = {
  idle: { fps: 4, loop: true },
  "running-right": { fps: 8, loop: true },
  "running-left": { fps: 8, loop: true },
  waving: { fps: 7, loop: false },
  jumping: { fps: 7, loop: false },
  failed: { fps: 6, loop: false },
  waiting: { fps: 5, loop: true },
  running: { fps: 8, loop: true },
  review: { fps: 7, loop: true },
};

function defaultAnchors(width: number, height: number): PetManifest["anchors"] {
  return {
    feet: [width / 2, height * 0.92],
    head: [width / 2, height * 0.4],
    speechBubble: [width * 0.66, height * 0.14],
  };
}

function defaultHitboxes(width: number, height: number): Record<"body" | "head", Rect> {
  return {
    body: { x: width * 0.16, y: height * 0.38, width: width * 0.68, height: height * 0.54 },
    head: { x: width * 0.17, y: height * 0.11, width: width * 0.66, height: height * 0.55 },
  };
}

export function adaptOpenPetsManifest(
  pet: OpenPetsManifest,
  image: OpenPetsImageInfo,
  extension?: DesklingExtension,
): PetManifest {
  const frameWidth = image.width / OPENPETS_COLUMNS;
  const frameHeight = image.height / OPENPETS_ROWS;
  const mappings = { ...DEFAULT_MAP, ...extension?.animationMap };
  const animations: PetManifest["animations"] = {};

  for (const [semantic, target] of Object.entries(mappings)) {
    const primary = typeof target === "string" ? target : target.right;
    const primaryRow = OPENPETS_ANIMATIONS.indexOf(primary);
    const playback = {
      ...DEFAULT_PLAYBACK[primary],
      ...extension?.playback?.[primary],
      ...extension?.playback?.[semantic],
    };
    const detectedFrames = image.frameCounts?.[primaryRow] ?? OPENPETS_COLUMNS;
    animations[semantic] = {
      row: primaryRow,
      frames: playback.frames ?? detectedFrames,
      fps: playback.fps,
      loop: playback.loop,
      facingRows: typeof target === "string" ? undefined : {
        right: OPENPETS_ANIMATIONS.indexOf(target.right),
        left: OPENPETS_ANIMATIONS.indexOf(target.left),
      },
      facingFrames: typeof target === "string" || playback.frames !== undefined ? undefined : {
        right: extension?.playback?.[target.right]?.frames ??
          image.frameCounts?.[OPENPETS_ANIMATIONS.indexOf(target.right)] ?? OPENPETS_COLUMNS,
        left: extension?.playback?.[target.left]?.frames ??
          image.frameCounts?.[OPENPETS_ANIMATIONS.indexOf(target.left)] ?? OPENPETS_COLUMNS,
      },
    };
  }

  return {
    schemaVersion: 1,
    id: pet.id,
    name: pet.displayName,
    author: "OpenPets package",
    description: pet.description,
    compatibilityProfile: OPENPETS_PROFILE,
    renderer: { type: "sprite", asset: pet.spritesheetPath, frameWidth, frameHeight },
    animations,
    anchors: extension?.anchors ?? defaultAnchors(frameWidth, frameHeight),
    hitboxes: extension?.hitboxes ?? defaultHitboxes(frameWidth, frameHeight),
    sounds: extension?.sounds,
    personality: extension?.personality,
  };
}
