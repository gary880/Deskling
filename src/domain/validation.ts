import type { PetManifest, Rect } from "./avatar";
import { sanitizePersonalityOverride } from "./personality";
import {
  OPENPETS_ANIMATIONS,
  OPENPETS_COLUMNS,
  OPENPETS_PROFILE,
  OPENPETS_ROWS,
  type DesklingExtension,
  type OpenPetsManifest,
} from "./openPets";

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

export interface ValidationLayer {
  valid: boolean;
  issues: string[];
  message?: string;
}

export interface PackageValidationResult {
  openPets: ValidationLayer;
  deskling: ValidationLayer;
}

function safeRelativePath(value: string): boolean {
  return Boolean(value) && !value.includes("\\") && !value.includes(":") &&
    !value.startsWith("/") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function validateOpenPetsManifest(
  value: unknown,
  image?: { width: number; height: number },
): OpenPetsManifest {
  const issues: string[] = [];
  if (!isObject(value)) throw new InvalidPetPackageError(["pet.json must be an object"]);
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.id)) {
    issues.push("pet.json id must use lowercase letters, numbers, or hyphens");
  }
  if (typeof value.displayName !== "string" || !value.displayName.trim()) {
    issues.push("pet.json displayName is required");
  }
  if (typeof value.description !== "string") issues.push("pet.json description must be a string");
  if (typeof value.spritesheetPath !== "string" ||
      !safeRelativePath(value.spritesheetPath) || !value.spritesheetPath.endsWith(".webp")) {
    issues.push("pet.json spritesheetPath must be a safe relative WebP path");
  }
  if (image && (image.width % OPENPETS_COLUMNS !== 0 || image.height % OPENPETS_ROWS !== 0)) {
    issues.push("OpenPets spritesheet must be divisible into an 8×9 atlas");
  }
  if (issues.length) throw new InvalidPetPackageError(issues);
  return value as unknown as OpenPetsManifest;
}

export function validateDesklingExtension(value: unknown): DesklingExtension {
  const issues: string[] = [];
  if (!isObject(value)) throw new InvalidPetPackageError(["deskling.json must be an object"]);
  if (value.schemaVersion !== 1) issues.push("deskling.json schemaVersion must be 1");
  if (value.extends !== undefined) {
    if (!isObject(value.extends) || value.extends.format !== "openpets" ||
        value.extends.profile !== OPENPETS_PROFILE) {
      issues.push(`deskling.json extends must target openpets/${OPENPETS_PROFILE}`);
    }
  }
  if (value.animationMap !== undefined) {
    if (!isObject(value.animationMap)) issues.push("deskling.json animationMap must be an object");
    else for (const [semantic, target] of Object.entries(value.animationMap)) {
      const names = typeof target === "string" ? [target] : isObject(target) ? [target.right, target.left] : [];
      if (!semantic || names.length === 0 || names.some((name) =>
        typeof name !== "string" || !(OPENPETS_ANIMATIONS as readonly string[]).includes(name))) {
        issues.push(`animationMap.${semantic} must reference OpenPets animation names`);
      }
    }
  }
  if (issues.length) throw new InvalidPetPackageError(issues);
  return value as unknown as DesklingExtension;
}

export function validateOpenPetsPackage(
  petValue: unknown,
  extensionValue: unknown | undefined,
  image?: { width: number; height: number },
): PackageValidationResult {
  const openPetsIssues: string[] = [];
  const desklingIssues: string[] = [];
  try { validateOpenPetsManifest(petValue, image); } catch (error) {
    openPetsIssues.push(...(error instanceof InvalidPetPackageError ? error.issues : [String(error)]));
  }
  if (extensionValue !== undefined) {
    try { validateDesklingExtension(extensionValue); } catch (error) {
      desklingIssues.push(...(error instanceof InvalidPetPackageError ? error.issues : [String(error)]));
    }
  }
  return {
    openPets: { valid: openPetsIssues.length === 0, issues: openPetsIssues },
    deskling: {
      valid: desklingIssues.length === 0,
      issues: desklingIssues,
      message: extensionValue === undefined
        ? "OpenPets compatible. Deskling will use default anchors, hitboxes and animation mappings."
        : undefined,
    },
  };
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
