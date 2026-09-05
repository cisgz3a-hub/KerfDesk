import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => vi.restoreAllMocks());

  it('uses the default when the browser denies access to the storage property', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage disabled for this origin', 'SecurityError');
    });
    expect(readCanvasStartMarkersVisible()).toBe(true);
    expect(() => writeCanvasStartMarkersVisible(false)).not.toThrow();
  });

  it('keeps storage method failures optional', () => {
    const storage = {
      getItem: () => {
        throw new Error('Storage read unavailable');
      },
      setItem: () => {
        throw new Error('Storage quota unavailable');
      },
    };
    expect(readCanvasStartMarkersVisible(storage)).toBe(true);
    expect(() => writeCanvasStartMarkersVisible(false, storage)).not.toThrow();
  });

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
