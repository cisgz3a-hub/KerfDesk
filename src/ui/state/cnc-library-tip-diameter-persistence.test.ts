import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncTool } from '../../core/scene';
import {
  CNC_LIBRARY_STORAGE_KEY,
  parseCncLibrary,
  persistCncLibrary,
  restoreCncLibrary,
  type CncLibrary,
} from './cnc-library-persistence';

const FLAT_ENGRAVER: CncTool = {
  id: 'flat-engraver',
  name: '30 degree flat-tip engraver',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 0.2,
};

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const slots = new Map<string, string>();
  return {
    getItem: (key) => slots.get(key) ?? null,
    setItem: (key, value) => void slots.set(key, value),
    removeItem: (key) => void slots.delete(key),
  };
}

describe('CNC library tip-diameter persistence', () => {
  it('round-trips flat-tip geometry in both custom tools and saved machine profiles', () => {
    const storage = memoryStorage();
    const library: CncLibrary = {
      customTools: [FLAT_ENGRAVER],
      feedPresets: [],
      machineProfiles: [
        {
          id: 'profile-flat-engraver',
          name: 'Flat engraver profile',
          machine: {
            ...DEFAULT_CNC_MACHINE_CONFIG,
            tools: [FLAT_ENGRAVER],
            toolId: FLAT_ENGRAVER.id,
          },
        },
      ],
    };

    expect(persistCncLibrary(storage, library)).toBe(true);
    expect(storage.getItem(CNC_LIBRARY_STORAGE_KEY)).toContain('"tipDiameterMm":0.2');
    expect(restoreCncLibrary(storage)).toEqual(library);
  });

  it('keeps explicit engraving tips visible but drops wrong-kind metadata', () => {
    const parsed = parseCncLibrary(
      JSON.stringify({
        customTools: [
          { ...FLAT_ENGRAVER, id: 'point', tipDiameterMm: 0 },
          { ...FLAT_ENGRAVER, id: 'negative', tipDiameterMm: -0.1 },
          { ...FLAT_ENGRAVER, id: 'full-width', tipDiameterMm: FLAT_ENGRAVER.diameterMm },
          { ...FLAT_ENGRAVER, id: 'v-bit', kind: 'v-bit', tipDiameterMm: 0.2 },
        ],
      }),
    );

    expect(parsed?.customTools.find((tool) => tool.id === 'point')?.tipDiameterMm).toBe(0);
    expect(parsed?.customTools.find((tool) => tool.id === 'negative')?.tipDiameterMm).toBe(-0.1);
    expect(parsed?.customTools.find((tool) => tool.id === 'full-width')?.tipDiameterMm).toBe(
      FLAT_ENGRAVER.diameterMm,
    );
    expect(parsed?.customTools.find((tool) => tool.id === 'v-bit')?.tipDiameterMm).toBeUndefined();
  });
});
