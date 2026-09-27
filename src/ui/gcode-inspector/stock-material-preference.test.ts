import { describe, expect, it } from 'vitest';
import {
  STOCK_MATERIAL_KEY,
  readStockMaterial,
  stockMaterialFor,
  writeStockMaterial,
} from './stock-material-preference';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('carved stock material preference (ADR-487)', () => {
  it('defaults to wood and remembers the choice', () => {
    const storage = memoryStorage();
    expect(readStockMaterial(storage)).toBe('wood');
    writeStockMaterial('aluminium', storage);
    expect(storage.getItem(STOCK_MATERIAL_KEY)).toBe('aluminium');
    expect(readStockMaterial(storage)).toBe('aluminium');
  });

  it('falls back to wood for unknown values and unavailable storage', () => {
    const storage = memoryStorage();
    storage.setItem(STOCK_MATERIAL_KEY, 'granite');
    expect(readStockMaterial(storage)).toBe('wood');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStockMaterial(broken)).toBe('wood');
    expect(() => writeStockMaterial('mdf', broken)).not.toThrow();
    expect(readStockMaterial(null)).toBe('wood');
  });

  it("draws the project's stock material as the nearest stock material", () => {
    expect(stockMaterialFor('hardwood-walnut')).toBe('wood');
    expect(stockMaterialFor('softwood')).toBe('wood');
    expect(stockMaterialFor('plywood-mdf')).toBe('mdf');
    expect(stockMaterialFor('acrylic')).toBe('acrylic');
    expect(stockMaterialFor('aluminum')).toBe('aluminium');
    expect(stockMaterialFor(undefined)).toBeNull();
    expect(stockMaterialFor('granite')).toBeNull();
  });
});
