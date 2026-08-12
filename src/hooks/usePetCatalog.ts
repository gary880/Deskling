import { useEffect, useState } from "react";
import type { PetPackage } from "../domain/avatar";
import {
  loadInstalledOpenPetsPackage,
  loadInstalledPetPackage,
  loadPetPackage,
} from "../domain/packageLoader";
import { findDuplicateIds } from "../domain/validation";
import { DESKTOP_EVENTS, listInstalledPets, listenDesktop } from "../desktop/bridge";

interface PetCatalogState {
  packages: PetPackage[];
  error: string | null;
  reload: () => void;
}

export function usePetCatalog(): PetCatalogState {
  const [packages, setPackages] = useState<PetPackage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      try {
        const response = await fetch("/pets/index.json");
        if (!response.ok) throw new Error("找不到 pet catalog");
        const manifestUrls = (await response.json()) as string[];
        const [bundled, installed] = await Promise.all([
          Promise.all(manifestUrls.map(loadPetPackage)), listInstalledPets(),
        ]);
        const loadedInstalled = await Promise.all(installed.map((pet) =>
          pet.petManifest !== undefined
            ? loadInstalledOpenPetsPackage(pet.petManifest, pet.extension, pet.baseDir, pet.frameCounts)
            : loadInstalledPetPackage(pet.manifest, pet.baseDir)));
        const loaded = [...bundled, ...loadedInstalled];
        const duplicates = findDuplicateIds(loaded.map((pkg) => pkg.manifest));
        if (duplicates.length) throw new Error(`重複的 pet id：${duplicates.join(", ")}`);
        if (active) { setPackages(loaded); setError(null); }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "無法載入 Pet Package");
        }
      }
    }
    void loadCatalog();
    return () => {
      active = false;
    };
  }, [revision]);

  useEffect(() => {
    let unlisten: () => void = () => undefined;
    void listenDesktop<null>(DESKTOP_EVENTS.petCatalogChanged, () => setRevision((value) => value + 1))
      .then((next) => { unlisten = next; });
    return () => unlisten();
  }, []);

  return { packages, error, reload: () => setRevision((value) => value + 1) };
}
