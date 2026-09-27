// The carved stock's material (ADR-487). The project's own program starts on
// the project's stock material; any other starts on the one last chosen,
// remembered per browser, or wood. An operator who cuts aluminium keeps it
// across sessions.

import { useCallback, useState } from 'react';
import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import { browserLocalStorage } from '../state/browser-local-storage';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { STOCK_MATERIALS, type StockMaterial } from '../viewer3d/scene-stock-materials';

export const STOCK_MATERIAL_KEY = 'laserforge.inspector-stock-material.v1';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readStockMaterial(
  storage: PreferenceStorage | null = browserLocalStorage(),
): StockMaterial {
  try {
    const stored = storage?.getItem(STOCK_MATERIAL_KEY);
    return STOCK_MATERIALS.find((material) => material === stored) ?? 'wood';
  } catch {
    return 'wood';
  }
}

export function writeStockMaterial(
  material: StockMaterial,
  storage: PreferenceStorage | null = browserLocalStorage(),
): void {
  try {
    storage?.setItem(STOCK_MATERIAL_KEY, material);
  } catch {
    // Storage is optional; the in-memory choice still applies this session.
  }
}

// Each CNC material family is drawn as the nearest stock material.
const FROM_FAMILY: Readonly<Record<string, StockMaterial>> = {
  softwood: 'wood',
  hardwood: 'wood',
  'plywood-mdf': 'mdf',
  acrylic: 'acrylic',
  aluminum: 'aluminium',
};

/** The stock material the project's material is drawn as; null without one. */
export function stockMaterialFor(materialKey: string | undefined): StockMaterial | null {
  const family = CHIPLOAD_MATERIALS.find((material) => material.value === materialKey)?.family;
  return family === undefined ? null : (FROM_FAMILY[family] ?? null);
}

export function useStockMaterial(
  fromProject: StockMaterial | null,
): readonly [StockMaterial, (material: StockMaterial) => void] {
  const [remembered, setRemembered] = useState<StockMaterial>(() => readStockMaterial());
  // A choice holds for the program it was made on; a program from another
  // project starts on its own material again.
  const [chosen, setChosen] = useState<{
    readonly over: StockMaterial | null;
    readonly material: StockMaterial;
  } | null>(null);
  const material =
    chosen !== null && chosen.over === fromProject ? chosen.material : (fromProject ?? remembered);
  const choose = useCallback(
    (next: StockMaterial) => {
      setChosen({ over: fromProject, material: next });
      setRemembered(next);
      writeStockMaterial(next);
    },
    [fromProject],
  );
  return [material, choose] as const;
}
