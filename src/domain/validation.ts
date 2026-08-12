import type { PetManifest, Rect } from "./avatar";
import { sanitizePersonalityOverride } from "./personality";

const CORE_ANIMATIONS = ["idle", "walk", "sleep", "thinking", "talking", "happy"];
const ANCHORS = ["feet", "head", "speechBubble"] as const;
const HITBOXES = ["body", "head"] as const;

export class InvalidPetPackageError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid Pet Package: ${issues.join("; ")}`);
    this.name = "InvalidPetPackageError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function rectWithinFrame(rect: Rect, width: number, height: number): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= width &&
    rect.y + rect.height <= height
  );
}

export function validateManifest(
  value: unknown,
  image?: { width: number; height: number },
): PetManifest {
  const issues: string[] = [];
  if (!isObject(value)) throw new InvalidPetPackageError(["manifest must be an object"]);

  if (value.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.id)) {
    issues.push("id must use lowercase letters, numbers, or hyphens");
  }
  if (typeof value.name !== "string" || !value.name.trim()) issues.push("name is required");
  if (typeof value.author !== "string" || !value.author.trim()) issues.push("author is required");

  const renderer = isObject(value.renderer) ? value.renderer : {};
  if (renderer.type !== "sprite") issues.push("renderer.type must be sprite");
  if (typeof renderer.asset !== "string" || !renderer.asset.endsWith(".webp")) {
    issues.push("renderer.asset must be a WebP file");
  }
  if (!positiveInteger(renderer.frameWidth)) issues.push("frameWidth must be a positive integer");
  if (!positiveInteger(renderer.frameHeight)) issues.push("frameHeight must be a positive integer");

  const frameWidth = positiveInteger(renderer.frameWidth) ? renderer.frameWidth : 0;
  const frameHeight = positiveInteger(renderer.frameHeight) ? renderer.frameHeight : 0;
  const animations = isObject(value.animations) ? value.animations : {};
  if (Object.keys(animations).length === 0) issues.push("at least one animation is required");

  for (const required of CORE_ANIMATIONS) {
    if (!animations[required]) issues.push(`core animation ${required} is missing (runtime will fallback)`);
  }

  const columns = image && frameWidth ? image.width / frameWidth : Infinity;
  const rows = image && frameHeight ? image.height / frameHeight : Infinity;
  if (image && (!Number.isInteger(columns) || !Number.isInteger(rows))) {
    issues.push("spritesheet dimensions must be divisible by frame dimensions");
  }

  for (const [id, definition] of Object.entries(animations)) {
    if (!isObject(definition)) {
      issues.push(`animation ${id} must be an object`);
      continue;
    }
    if (!Number.isInteger(definition.row) || Number(definition.row) < 0 || Number(definition.row) >= rows) {
      issues.push(`animation ${id} row is outside the spritesheet`);
    }
    if (!positiveInteger(definition.frames) || Number(definition.frames) > columns) {
      issues.push(`animation ${id} frame range is outside the spritesheet`);
    }
    if (typeof definition.fps !== "number" || definition.fps <= 0 || definition.fps > 60) {
      issues.push(`animation ${id} fps must be between 0 and 60`);
    }
    if (typeof definition.loop !== "boolean") issues.push(`animation ${id} loop must be boolean`);
  }

  const anchors = isObject(value.anchors) ? value.anchors : {};
  for (const name of ANCHORS) {
    const point = anchors[name];
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      typeof point[0] !== "number" ||
      typeof point[1] !== "number" ||
      point[0] < 0 ||
      point[1] < 0 ||
      point[0] > frameWidth ||
      point[1] > frameHeight
    ) {
      issues.push(`anchor ${name} must be inside the frame`);
    }
  }

  const hitboxes = isObject(value.hitboxes) ? value.hitboxes : {};
  for (const name of HITBOXES) {
    const rect = hitboxes[name];
    if (!isObject(rect) || !rectWithinFrame(rect as unknown as Rect, frameWidth, frameHeight)) {
      issues.push(`hitbox ${name} must be inside the frame`);
    }
  }

  if (value.personality !== undefined) {
    if (!isObject(value.personality)) issues.push("personality must be an object");
    else {
      const sanitized = sanitizePersonalityOverride(value.personality);
      const rawTraits = isObject(value.personality.traits) ? value.personality.traits : {};
      for (const key of ["warmth", "energy", "humor", "directness", "verbosity"] as const) {
        if (rawTraits[key] !== undefined &&
          (typeof rawTraits[key] !== "number" || rawTraits[key] < 0 || rawTraits[key] > 100)) {
          issues.push(`personality.traits.${key} must be between 0 and 100`);
        }
      }
      if (value.personality.preferredLanguage !== undefined && !sanitized.preferredLanguage) {
        issues.push("personality.preferredLanguage is invalid");
      }
    }
  }

  // Missing core animations are warnings handled by runtime fallback, not package-fatal errors.
  const fatalIssues = issues.filter((issue) => !issue.includes("runtime will fallback"));
  if (fatalIssues.length) throw new InvalidPetPackageError(fatalIssues);
  return value as unknown as PetManifest;
}

export function findDuplicateIds(manifests: PetManifest[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) duplicates.add(manifest.id);
    seen.add(manifest.id);
  }
  return [...duplicates];
}
