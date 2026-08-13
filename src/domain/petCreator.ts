import type { PetPackage } from "./avatar";
import {
  adaptOpenPetsManifest,
  OPENPETS_ANIMATIONS,
  type DesklingExtension,
  type OpenPetsManifest,
} from "./openPets";
import {
  InvalidPetPackageError,
  validateDesklingExtension,
  validateManifest,
  validateOpenPetsManifest,
} from "./validation";

const encoder = new TextEncoder();
const MAX_IMPORTABLE_ZIP_SIZE = 25 * 1024 * 1024;
const ALLOWED_RESOURCE = /\.(?:webp|wav|mp3|ogg)$/i;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
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

function safePackagePath(value: string): boolean {
  return Boolean(value) && !value.includes("\\") && !value.includes(":") &&
    !value.startsWith("/") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): number {
  view.setUint16(offset, value, true);
  return offset + 2;
}

function writeUint32(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value, true);
  return offset + 4;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Builds a standards-compliant ZIP using stored entries, avoiding a large browser ZIP dependency. */
export function buildStoredZip(entries: ZipEntry[]): Uint8Array {
  if (!entries.length) throw new Error("ZIP must contain at least one file");
  const names = new Set<string>();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    if (!safePackagePath(entry.name) || names.has(entry.name)) {
      throw new Error(`Unsafe or duplicate ZIP path: ${entry.name}`);
    }
    names.add(entry.name);
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    let cursor = 0;
    cursor = writeUint32(localView, cursor, 0x04034b50);
    cursor = writeUint16(localView, cursor, 20);
    cursor = writeUint16(localView, cursor, 0x0800);
    cursor = writeUint16(localView, cursor, 0);
    cursor = writeUint16(localView, cursor, 0);
    cursor = writeUint16(localView, cursor, 0x0021);
    cursor = writeUint32(localView, cursor, checksum);
    cursor = writeUint32(localView, cursor, entry.data.length);
    cursor = writeUint32(localView, cursor, entry.data.length);
    cursor = writeUint16(localView, cursor, name.length);
    writeUint16(localView, cursor, 0);
    localHeader.set(name, 30);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    cursor = 0;
    cursor = writeUint32(centralView, cursor, 0x02014b50);
    cursor = writeUint16(centralView, cursor, 20);
    cursor = writeUint16(centralView, cursor, 20);
    cursor = writeUint16(centralView, cursor, 0x0800);
    cursor = writeUint16(centralView, cursor, 0);
    cursor = writeUint16(centralView, cursor, 0);
    cursor = writeUint16(centralView, cursor, 0x0021);
    cursor = writeUint32(centralView, cursor, checksum);
    cursor = writeUint32(centralView, cursor, entry.data.length);
    cursor = writeUint32(centralView, cursor, entry.data.length);
    cursor = writeUint16(centralView, cursor, name.length);
    cursor = writeUint16(centralView, cursor, 0);
    cursor = writeUint16(centralView, cursor, 0);
    cursor = writeUint16(centralView, cursor, 0);
    cursor = writeUint16(centralView, cursor, 0);
    cursor = writeUint32(centralView, cursor, 0);
    writeUint32(centralView, cursor, localOffset);
    centralHeader.set(name, 46);

    localParts.push(localHeader, entry.data);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + entry.data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  let cursor = 0;
  cursor = writeUint32(endView, cursor, 0x06054b50);
  cursor = writeUint16(endView, cursor, 0);
  cursor = writeUint16(endView, cursor, 0);
  cursor = writeUint16(endView, cursor, entries.length);
  cursor = writeUint16(endView, cursor, entries.length);
  cursor = writeUint32(endView, cursor, centralSize);
  cursor = writeUint32(endView, cursor, localOffset);
  writeUint16(endView, cursor, 0);
  return concat([...localParts, ...centralParts, end]);
}

export function extensionFromPackage(pkg: PetPackage): DesklingExtension {
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

async function fetchBytes(url: string, label: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot read ${label}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function createOpenPetsPackageZip(
  pkg: PetPackage,
  extensionValue: unknown,
  petValue: unknown = pkg.openPetsManifest,
): Promise<Uint8Array> {
  if (pkg.manifest.compatibilityProfile !== "codex-pets-8x9" || !pkg.openPetsManifest) {
    throw new InvalidPetPackageError(["Creator export requires an OpenPets package"]);
  }
  const pet = validateOpenPetsManifest(petValue, {
    width: pkg.imageWidth,
    height: pkg.imageHeight,
  });
  const extension = validateDesklingExtension(extensionValue);
  validateManifest(adaptOpenPetsManifest(pet, {
    width: pkg.imageWidth,
    height: pkg.imageHeight,
    frameCounts: pkg.atlasFrameCounts,
  }, extension), { width: pkg.imageWidth, height: pkg.imageHeight });

  const resources = new Map<string, string>([[pet.spritesheetPath, pkg.assetUrl]]);
  for (const path of Object.values(extension.sounds ?? {})) {
    if (path === undefined) continue;
    if (!safePackagePath(path) || !ALLOWED_RESOURCE.test(path)) {
      throw new InvalidPetPackageError([`unsafe or unsupported sound path: ${path}`]);
    }
    resources.set(path, new URL(path, pkg.manifestUrl).href);
  }
  const entries: ZipEntry[] = [
    { name: "pet.json", data: encoder.encode(`${JSON.stringify(pet, null, 2)}\n`) },
    { name: "deskling.json", data: encoder.encode(`${JSON.stringify(extension, null, 2)}\n`) },
  ];
  for (const [path, url] of resources) {
    entries.push({ name: path, data: await fetchBytes(url, path) });
  }
  const archive = buildStoredZip(entries);
  if (archive.length > MAX_IMPORTABLE_ZIP_SIZE) {
    throw new Error("Exported ZIP exceeds Deskling's 25 MB import limit");
  }
  return archive;
}

export function creatorPetFromPackage(pkg: PetPackage): OpenPetsManifest | null {
  if (!pkg.openPetsManifest) return null;
  return {
    ...pkg.openPetsManifest,
    id: pkg.source === "bundled" ? `${pkg.openPetsManifest.id}-custom` : pkg.openPetsManifest.id,
  };
}
