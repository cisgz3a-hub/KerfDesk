import { afterEach, describe, expect, it } from 'vitest';
import {
  DISPLAY_UNITS_KEY,
  normalizeDisplayUnit,
  readDisplayUnit,
  useDisplayUnitsStore,
} from './display-units';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

afterEach(() => useDisplayUnitsStore.setState({ lengthUnit: 'mm' }));

describe('display units preference (ADR-629)', () => {
  it('defaults to millimetres and reads a saved inch choice', () => {
    expect(readDisplayUnit(memoryStorage())).toBe('mm');
    expect(readDisplayUnit(memoryStorage({ [DISPLAY_UNITS_KEY]: 'in' }))).toBe('in');
    expect(readDisplayUnit(null)).toBe('mm');
  });

  it('treats anything unknown as millimetres', () => {
    expect(normalizeDisplayUnit('feet')).toBe('mm');
    expect(normalizeDisplayUnit(undefined)).toBe('mm');
  });

  it('switches the store between units', () => {
    useDisplayUnitsStore.getState().setLengthUnit('in');
    expect(useDisplayUnitsStore.getState().lengthUnit).toBe('in');
    useDisplayUnitsStore.getState().setLengthUnit('mm');
    expect(useDisplayUnitsStore.getState().lengthUnit).toBe('mm');
  });
});
