import { afterEach, describe, expect, it, vi } from "vitest";
import bellaExtension from "../../public/pets/bella/deskling.json";
import bellaPet from "../../public/pets/bella/pet.json";
import type { PetPackage } from "./avatar";
import { adaptOpenPetsManifest } from "./openPets";
import { buildStoredZip, createOpenPetsPackageZip, creatorPetFromPackage, extensionFromPackage } from "./petCreator";
import { validateDesklingExtension, validateOpenPetsManifest } from "./validation";

const decoder = new TextDecoder();

function storedEntries(archive: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(archive.subarray(nameStart, nameStart + nameLength));
    entries.set(name, archive.slice(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function bellaPackage(): PetPackage {
  const pet = validateOpenPetsManifest(bellaPet);
  const extension = validateDesklingExtension(bellaExtension);
  const dimensions = { width: 1536, height: 1872 };
  return {
    source: "bundled",
    manifest: adaptOpenPetsManifest(pet, dimensions, extension),
    manifestUrl: "https://deskling.test/pets/bella/pet.json",
    assetUrl: "https://deskling.test/pets/bella/spritesheet.webp",
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
    openPetsManifest: pet,
    desklingExtension: extension,
    atlasFrameCounts: [6, 8, 8, 4, 5, 6, 8, 6, 5],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("buildStoredZip", () => {
  it("writes importable root and nested entries with a central directory", () => {
    const archive = buildStoredZip([
      { name: "pet.json", data: new TextEncoder().encode("{\"id\":\"fox\"}") },
      { name: "sounds/happy.ogg", data: new Uint8Array([1, 2, 3]) },
    ]);
    const entries = storedEntries(archive);
    expect([...entries]).toEqual([
      ["pet.json", expect.any(Uint8Array)],
      ["sounds/happy.ogg", expect.any(Uint8Array)],
    ]);
    expect(decoder.decode(entries.get("pet.json"))).toBe("{\"id\":\"fox\"}");
    expect(new DataView(archive.buffer).getUint32(archive.length - 22, true)).toBe(0x06054b50);
  });

  it("writes the standard CRC-32 value into local and central headers", () => {
    const data = new TextEncoder().encode("123456789");
    const archive = buildStoredZip([{ name: "check.txt", data }]);
    const view = new DataView(archive.buffer);
    const centralOffset = 30 + "check.txt".length + data.length;
    expect(view.getUint32(14, true)).toBe(0xcbf43926);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    expect(view.getUint32(centralOffset + 16, true)).toBe(0xcbf43926);
  });

  it("rejects traversal and duplicate paths", () => {
    expect(() => buildStoredZip([{ name: "../pet.json", data: new Uint8Array() }])).toThrow(/Unsafe/);
    expect(() => buildStoredZip([
      { name: "pet.json", data: new Uint8Array() },
      { name: "pet.json", data: new Uint8Array() },
    ])).toThrow(/duplicate/);
  });
});

describe("Creator package round trip", () => {
  it("preserves OpenPets metadata and exports edited sidecar plus every referenced asset", async () => {
    const pkg = bellaPackage();
    const extension = structuredClone(pkg.desklingExtension!);
    extension.personality = { nickname: "Bells", preferredLanguage: "zh-TW" };
    extension.sounds = { happy: "sounds/happy.ogg" };
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      fetched.push(url);
      return new Response(url.endsWith(".webp") ? new Uint8Array([8, 9, 10]) : new Uint8Array([4, 5]));
    }));

    const entries = storedEntries(await createOpenPetsPackageZip(pkg, extension));

    expect([...entries.keys()]).toEqual([
      "pet.json", "deskling.json", "spritesheet.webp", "sounds/happy.ogg",
    ]);
    expect(JSON.parse(decoder.decode(entries.get("pet.json")!))).toEqual(bellaPet);
    expect(JSON.parse(decoder.decode(entries.get("deskling.json")!)).personality.nickname).toBe("Bells");
    expect(fetched).toEqual([
      "https://deskling.test/pets/bella/spritesheet.webp",
      "https://deskling.test/pets/bella/sounds/happy.ogg",
    ]);
  });

  it("derives a complete editable sidecar from package runtime defaults", () => {
    const pkg = bellaPackage();
    const extension = extensionFromPackage(pkg);
    expect(extension.extends?.profile).toBe("codex-pets-8x9");
    expect(extension.anchors?.feet).toBeDefined();
    expect(extension.hitboxes?.body).toBeDefined();
    expect(extension.animationMap?.walk).toEqual({ right: "running-right", left: "running-left" });
    expect(extension.animationMap?.sleep).toBe("review");
    expect(extension.animationMap?.talking).toBe("running");
    expect(extension.animationMap?.energetic).toBe("jumping");
    expect(creatorPetFromPackage(pkg)?.id).toBe("bella-custom");
  });
});
