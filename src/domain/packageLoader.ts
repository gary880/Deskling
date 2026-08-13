import type { PetPackage } from "./avatar";
import { adaptOpenPetsManifest } from "./openPets";
import { OPENPETS_COLUMNS, OPENPETS_ROWS, type OpenPetsImageInfo } from "./openPets";
import {
  InvalidPetPackageError,
  validateDesklingExtension,
  validateManifest,
  validateOpenPetsManifest,
} from "./validation";

function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new InvalidPetPackageError([`asset does not exist: ${url}`]));
    image.src = url;
  });
}

function loadOpenPetsImageInfo(url: string): Promise<OpenPetsImageInfo> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve({ width, height });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, width, height).data;
        const frameWidth = width / OPENPETS_COLUMNS;
        const frameHeight = height / OPENPETS_ROWS;
        if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight)) {
          return resolve({ width, height });
        }
        const frameCounts = Array.from({ length: OPENPETS_ROWS }, (_, row) => {
          for (let column = OPENPETS_COLUMNS - 1; column >= 0; column -= 1) {
            const startX = column * frameWidth;
            const startY = row * frameHeight;
            for (let y = startY; y < startY + frameHeight; y += 1) {
              for (let x = startX; x < startX + frameWidth; x += 1) {
                if (pixels[(y * width + x) * 4 + 3] !== 0) return column + 1;
              }
            }
          }
          return 1;
        });
        resolve({ width, height, frameCounts });
      } catch {
        // Some asset protocols disallow canvas pixel reads. The atlas remains loadable;
        // in that case the standard eight-frame behavior is the safe fallback.
        resolve({ width, height });
      }
    };
    image.onerror = () => reject(new InvalidPetPackageError([`asset does not exist: ${url}`]));
    image.src = url;
  });
}

export async function loadPetPackage(manifestUrl: string): Promise<PetPackage> {
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new InvalidPetPackageError([`manifest does not exist: ${manifestUrl}`]);
  }

  const raw: unknown = await response.json();
  if (manifestUrl.endsWith("/pet.json")) {
    const pet = validateOpenPetsManifest(raw);
    const packageUrl = new URL(manifestUrl, window.location.href);
    const assetUrl = new URL(pet.spritesheetPath, packageUrl).href;
    const sidecarUrl = new URL("deskling.json", packageUrl).href;
    const sidecarResponse = await fetch(sidecarUrl);
    if (!sidecarResponse.ok && sidecarResponse.status !== 404) {
      throw new InvalidPetPackageError([`cannot load optional sidecar: ${sidecarUrl}`]);
    }
    const extension = sidecarResponse.ok
      ? validateDesklingExtension(await sidecarResponse.json())
      : undefined;
    const dimensions = await loadOpenPetsImageInfo(assetUrl);
    validateOpenPetsManifest(raw, dimensions);
    const manifest = validateManifest(adaptOpenPetsManifest(pet, dimensions, extension), dimensions);
    return {
      source: "bundled", manifest, manifestUrl, assetUrl,
      imageWidth: dimensions.width, imageHeight: dimensions.height,
      desklingExtension: extension,
      openPetsManifest: pet,
      atlasFrameCounts: dimensions.frameCounts,
    };
  }
  const preliminary = validateManifest(raw);
  const assetUrl = new URL(preliminary.renderer.asset, new URL(manifestUrl, window.location.href)).href;
  const dimensions = await loadImageDimensions(assetUrl);
  const manifest = validateManifest(raw, dimensions);

  return {
    source: "bundled",
    manifest,
    manifestUrl,
    assetUrl,
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
  };
}

export async function loadInstalledPetPackage(raw: unknown, baseDir: string): Promise<PetPackage> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const preliminary = validateManifest(raw);
  const baseUrl = convertFileSrc(baseDir.replace(/[/\\]$/, ""));
  const assetUrl = `${baseUrl}/${preliminary.renderer.asset.split("/").map(encodeURIComponent).join("/")}`;
  const dimensions = await loadImageDimensions(assetUrl);
  const manifest = validateManifest(raw, dimensions);
  return {
    source: "installed",
    manifest,
    manifestUrl: `${baseUrl}/deskling.json`,
    assetUrl,
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
  };
}

export async function loadInstalledOpenPetsPackage(
  petRaw: unknown,
  extensionRaw: unknown | undefined,
  baseDir: string,
  frameCounts?: number[],
): Promise<PetPackage> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const pet = validateOpenPetsManifest(petRaw);
  const extension = extensionRaw === undefined ? undefined : validateDesklingExtension(extensionRaw);
  const baseUrl = convertFileSrc(baseDir.replace(/[/\\]$/, ""));
  const assetUrl = `${baseUrl}/${pet.spritesheetPath.split("/").map(encodeURIComponent).join("/")}`;
  const dimensions = await loadImageDimensions(assetUrl);
  const imageInfo = { ...dimensions, frameCounts };
  validateOpenPetsManifest(petRaw, dimensions);
  const manifest = validateManifest(adaptOpenPetsManifest(pet, imageInfo, extension), dimensions);
  return {
    source: "installed",
    manifest,
    manifestUrl: `${baseUrl}/pet.json`,
    assetUrl,
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
    desklingExtension: extension,
    openPetsManifest: pet,
    atlasFrameCounts: frameCounts,
  };
}
