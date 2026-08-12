import { describe, expect, it } from "vitest";
import mochi from "../../public/pets/mochi/deskling.json";
import bellaExtension from "../../public/pets/bella/deskling.json";
import bellaPet from "../../public/pets/bella/pet.json";
import { adaptOpenPetsManifest } from "./openPets";
import {
  InvalidPetPackageError,
  findDuplicateIds,
  validateDesklingExtension,
  validateManifest,
  validateOpenPetsManifest,
  validateOpenPetsPackage,
} from "./validation";

describe("validateManifest", () => {
  it("accepts the legacy bundled package", () => {
    expect(validateManifest(mochi, { width: 1448, height: 1086 }).id).toBe("mochi");
  });

  it("accepts Bella as OpenPets plus a Deskling sidecar", () => {
    const dimensions = { width: 1536, height: 1872 };
    const pet = validateOpenPetsManifest(bellaPet, dimensions);
    const extension = validateDesklingExtension(bellaExtension);
    const manifest = validateManifest(adaptOpenPetsManifest(pet, dimensions, extension), dimensions);
    expect(manifest.id).toBe("bella");
    expect(manifest.compatibilityProfile).toBe("codex-pets-8x9");
    expect(manifest.animations.idle.frames).toBe(6);
    expect(manifest.animations.walk.facingRows).toEqual({ right: 1, left: 2 });
  });

  it("treats a missing Deskling sidecar as a valid enhanced package with defaults", () => {
    const dimensions = { width: 1536, height: 1872 };
    const result = validateOpenPetsPackage(bellaPet, undefined, dimensions);
    expect(result.openPets.valid).toBe(true);
    expect(result.deskling.valid).toBe(true);
    expect(result.deskling.message).toContain("default anchors");

    const manifest = adaptOpenPetsManifest(validateOpenPetsManifest(bellaPet), dimensions);
    expect(manifest.renderer.frameWidth).toBe(192);
    expect(manifest.renderer.frameHeight).toBe(208);
  });

  it("uses detected non-transparent frame counts when a sidecar does not override them", () => {
    const manifest = adaptOpenPetsManifest(validateOpenPetsManifest(bellaPet), {
      width: 1536,
      height: 1872,
      frameCounts: [6, 8, 8, 4, 5, 6, 8, 6, 5],
    });
    expect(manifest.animations.idle.frames).toBe(6);
    expect(manifest.animations.happy.frames).toBe(4);
    expect(manifest.animations.walk.facingFrames).toEqual({ right: 8, left: 8 });
  });

  it("reports OpenPets compatibility separately from Deskling enhancements", () => {
    const invalidSidecar = { ...bellaExtension, extends: { format: "deskling", profile: "8x9" } };
    const result = validateOpenPetsPackage(bellaPet, invalidSidecar, { width: 1536, height: 1872 });
    expect(result.openPets.valid).toBe(true);
    expect(result.deskling.valid).toBe(false);
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
