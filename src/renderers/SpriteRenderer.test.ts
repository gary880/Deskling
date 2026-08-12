import { describe, expect, it } from "vitest";
import manifestJson from "../../public/pets/mochi/deskling.json";
import type { PetPackage } from "../domain/avatar";
import { validateManifest } from "../domain/validation";
import { SpriteRenderer } from "./SpriteRenderer";

function mochiPackage(): PetPackage {
  return {
    manifest: validateManifest(manifestJson),
    manifestUrl: "/pets/mochi/deskling.json",
    assetUrl: "/pets/mochi/spritesheet.webp",
    imageWidth: 1448,
    imageHeight: 1086,
  };
}

describe("SpriteRenderer", () => {
  it("resolves unavailable semantic animations without throwing", async () => {
    const renderer = new SpriteRenderer();
    await renderer.load(mochiPackage());
    renderer.play("annoyed");
    expect(renderer.currentAnimation).toBe("idle");
  });

  it("mirrors anchors and hit tests when facing left", async () => {
    const renderer = new SpriteRenderer();
    await renderer.load(mochiPackage());
    renderer.setFacing("left");
    expect(renderer.getAnchor("speechBubble")).toEqual({ x: 59, y: 24 });
    expect(renderer.hitTest({ x: 91, y: 60 })).toBe("head");
  });
});
