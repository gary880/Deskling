import { describe, expect, it } from "vitest";
import mochi from "../../public/pets/mochi/deskling.json";
import bella from "../../public/pets/bella/deskling.json";
import { InvalidPetPackageError, findDuplicateIds, validateManifest } from "./validation";

describe("validateManifest", () => {
  it("accepts both bundled pet packages", () => {
    expect(validateManifest(mochi, { width: 1448, height: 1086 }).id).toBe("mochi");
    expect(validateManifest(bella, { width: 1536, height: 1872 }).id).toBe("bella");
  });

  it("rejects animation frames outside the sheet", () => {
    const invalid = structuredClone(mochi);
    invalid.animations.idle.frames = 9;
    expect(() => validateManifest(invalid, { width: 1448, height: 1086 })).toThrow(
      InvalidPetPackageError,
    );
  });

  it("rejects anchors outside the frame", () => {
    const invalid = structuredClone(mochi);
    invalid.anchors.feet = [999, 999];
    expect(() => validateManifest(invalid, { width: 1448, height: 1086 })).toThrow(
      /anchor feet/,
    );
  });

  it("detects duplicate package ids", () => {
    const manifest = validateManifest(mochi);
    expect(findDuplicateIds([manifest, manifest])).toEqual(["mochi"]);
  });
});
