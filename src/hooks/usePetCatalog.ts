import { useEffect, useState } from "react";
import type { PetPackage } from "../domain/avatar";
import { loadPetPackage } from "../domain/packageLoader";
import { findDuplicateIds } from "../domain/validation";

interface PetCatalogState {
  packages: PetPackage[];
  error: string | null;
}

export function usePetCatalog(): PetCatalogState {
  const [packages, setPackages] = useState<PetPackage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      try {
        const response = await fetch("/pets/index.json");
        if (!response.ok) throw new Error("找不到 pet catalog");
        const manifestUrls = (await response.json()) as string[];
        const loaded = await Promise.all(manifestUrls.map(loadPetPackage));
        const duplicates = findDuplicateIds(loaded.map((pkg) => pkg.manifest));
        if (duplicates.length) throw new Error(`重複的 pet id：${duplicates.join(", ")}`);
        if (active) setPackages(loaded);
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
  }, []);

  return { packages, error };
}
