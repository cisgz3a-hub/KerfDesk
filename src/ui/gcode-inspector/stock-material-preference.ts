// The carved stock's material, remembered per browser (ADR-487). Wood is the
// default; an operator who cuts aluminium keeps it across sessions.

import { useCallback, useState } from 'react';
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

export function useStockMaterial(): readonly [StockMaterial, (material: StockMaterial) => void] {
  const [material, setMaterial] = useState<StockMaterial>(() => readStockMaterial());
  const choose = useCallback((next: StockMaterial) => {
    setMaterial(next);
    writeStockMaterial(next);
  }, []);
  return [material, choose] as const;
}
