export type Point = { x: number; y: number };
export type Facing = "left" | "right";
export type AnchorName = "feet" | "head" | "speechBubble";
export type HitRegion = "body" | "head";

export interface AnimationDefinition {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PreferredLanguage = "auto" | "zh-TW" | "en" | "ja";

export interface PetPersonalityTraits {
  warmth: number;
  energy: number;
  humor: number;
  directness: number;
  verbosity: number;
}

export interface PetPersonality {
  nickname?: string;
  traits: PetPersonalityTraits;
  speakingStyle?: string;
  preferredLanguage: PreferredLanguage;
  customInstructions?: string;
}

export type PetPersonalityOverride = Partial<Omit<PetPersonality, "traits">> & {
  traits?: Partial<PetPersonalityTraits>;
};

export interface PetManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  author: string;
  renderer: {
    type: "sprite";
    asset: string;
    frameWidth: number;
    frameHeight: number;
  };
  animations: Record<string, AnimationDefinition>;
  anchors: Record<AnchorName, [number, number]>;
  hitboxes: Record<HitRegion, Rect>;
  sounds?: Partial<Record<string, string>>;
  personality?: PetPersonalityOverride;
}

export interface PetPackage {
  source: "bundled" | "installed";
  manifest: PetManifest;
  manifestUrl: string;
  assetUrl: string;
  imageWidth: number;
  imageHeight: number;
}

export interface AvatarRenderer {
  load(pkg: PetPackage): Promise<void>;
  play(animation: string): void;
  setFacing(direction: Facing): void;
  hitTest(point: Point): HitRegion | null;
  getAnchor(name: AnchorName): Point | null;
}
