import type { PetPackage } from "./avatar";
import { InvalidPetPackageError, validateManifest } from "./validation";

function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
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
