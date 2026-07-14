import { describe, expect, it } from 'vitest';
import {
  readCanvasStartMarkersVisible,
  writeCanvasStartMarkersVisible,
} from './canvas-motion-preferences';

function memoryStorage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> & {
  readonly value: () => string | null;
} {
  let stored = initial ?? null;
  return {
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
    value: () => stored,
  };
}

describe('canvas motion preferences', () => {
  it('defaults start markers to visible and restores an explicit hidden preference', () => {
    expect(readCanvasStartMarkersVisible(memoryStorage())).toBe(true);
    expect(readCanvasStartMarkersVisible(memoryStorage('0'))).toBe(false);
  });

  it('persists the visibility choice', () => {
    const storage = memoryStorage();
    writeCanvasStartMarkersVisible(false, storage);
    expect(storage.value()).toBe('0');
    writeCanvasStartMarkersVisible(true, storage);
    expect(storage.value()).toBe('1');
  });
});
