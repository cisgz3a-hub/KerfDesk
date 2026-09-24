import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

// ADR-373: a roller rotary may carry its roller diameter. Without one the
// ADR-127 surface-calibrated roller must keep producing the exact same bytes.

const LINE: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'a.svg',
  bounds: { minX: 0, minY: 5, maxX: 20, maxY: 55 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 10, y: 5 },
            { x: 10, y: 55 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

const RASTER: SceneObject = {
  kind: 'raster-image',
  id: 'R1',
  color: '#808080',
  source: 'x.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  pixelWidth: 4,
  pixelHeight: 4,
  dither: 'floyd-steinberg',
  linesPerMm: 4,
  lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
  bounds: { minX: 30, minY: 10, maxX: 40, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
};

const LEGACY_ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

function project(rotary: RotarySetup, withRaster = true): Project {
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary });
  const scene = addLayer(addObject(base.scene, LINE), createLayer({ id: 'L1', color: '#ff0000' }));
  if (!withRaster) return { ...base, scene };
  return {
    ...base,
    scene: addLayer(
      addObject(scene, RASTER),
      createLayer({ id: 'L2', color: '#808080', mode: 'image' }),
    ),
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function yWords(gcode: string): number[] {
  return [...gcode.matchAll(/Y(-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
}

describe('emitGcode roller rotary diameter (ADR-373)', () => {
  // Digests of emitGcode output captured from the code before ADR-373 (commit
  // 9c7e63b) for these exact projects: vector + raster, forward and reversed.
  it.each([
    [false, 'b33bd1d99725f0d57b6357981d4c2ea05aa5782e5f1d33a4604250f028b738de', 3731],
    [true, '4e80cf3342d03598e380a60e0aec4837ef334f46fb9622e4f3bb7e3a9ef62967', 3681],
  ])(
    'keeps a roller without a roller diameter byte-identical (reverse %s)',
    (reverseAxis, digest, length) => {
      const setup = reverseAxis ? { ...LEGACY_ROLLER, reverseAxis } : LEGACY_ROLLER;
      const result = emitGcode(project(setup));
      expect(result.preflight.ok).toBe(true);
      expect(result.gcode).toHaveLength(length);
      expect(sha256(result.gcode)).toBe(digest);
    },
  );

  it('scales emitted Y by motion per roller turn over the roller circumference', () => {
    const roller = { ...LEGACY_ROLLER, mmPerRotation: 40, rollerDiameterMm: 25 };
    const result = emitGcode(project(roller, false));
    expect(result.preflight.ok).toBe(true);
    // Surface extent 50 mm → 50 · 40/(π·25) machine mm, rebased to start at 0.
    const extent = 50 * (40 / (Math.PI * 25));
    expect(result.gcode).toContain(`X10.000 Y${extent.toFixed(3)}`);
    expect(Math.min(...yWords(result.gcode))).toBe(0);
    expect(Math.max(...yWords(result.gcode))).toBeCloseTo(extent, 3);
    // X is never touched by the rotary mapping.
    const xWords = (gcode: string) => gcode.match(/X[\d.]+/g) ?? [];
    expect(xWords(result.gcode)).toEqual(xWords(emitGcode(project(LEGACY_ROLLER, false)).gcode));
  });

  it('uses the object/roller ratio for the one-revolution wrap limit', () => {
    // Object Ø15: one revolution is π·15 ≈ 47.1 surface mm, less than the
    // 50 mm design, whatever the roller scale.
    const small = {
      ...LEGACY_ROLLER,
      objectDiameterMm: 15,
      mmPerRotation: 40,
      rollerDiameterMm: 25,
    };
    const result = emitGcode(project(small, false));
    expect(result.preflight.ok).toBe(false);
    expect(result.preflight.issues.some((issue) => issue.code === 'out-of-bed')).toBe(true);
    // Object Ø16: π·16 ≈ 50.3 surface mm, so the same 50 mm design fits.
    expect(emitGcode(project({ ...small, objectDiameterMm: 16 }, false)).preflight.ok).toBe(true);
  });

  it('ignores a leftover roller diameter on a chuck', () => {
    const chuck: RotarySetup = { ...LEGACY_ROLLER, type: 'chuck' };
    expect(emitGcode(project({ ...chuck, rollerDiameterMm: 25 })).gcode).toBe(
      emitGcode(project(chuck)).gcode,
    );
  });
});
