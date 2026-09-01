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

// ADR-127 N1: rotary Y scaling applies at emit, and disabled rotary output is
// byte-identical. Raster qualification is advisory: workstation-local policy
// must never change or suppress emitted bytes.

function lineProject(rotary: RotarySetup | undefined, yTopMm = 50): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: yTopMm },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 10, y: 0 },
              { x: 10, y: yTopMm },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const base = createProject(
    rotary === undefined ? DEFAULT_DEVICE_PROFILE : { ...DEFAULT_DEVICE_PROFILE, rotary },
  );
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 360,
  objectDiameterMm: 60, // circumference ≈ 188.5 → scale ≈ 1.9099
};

function rotaryRasterProject(includeVector = false): Project {
  const color = '#808080';
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    color,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 4,
    // 4×4 = 16 zero bytes.
    lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: CHUCK });
  let scene = addLayer(
    addObject(base.scene, raster),
    createLayer({ id: 'L1', color, mode: 'image' }),
  );
  if (includeVector) {
    const vector = lineProject(CHUCK).scene.objects[0];
    if (vector === undefined) throw new Error('Expected the vector fixture.');
    scene = addLayer(addObject(scene, vector), createLayer({ id: 'L2', color: '#ff0000' }));
  }
  return { ...base, scene };
}

describe('emitGcode rotary (ADR-127)', () => {
  it('is byte-identical with rotary absent vs disabled', () => {
    const absent = emitGcode(lineProject(undefined));
    const disabled = emitGcode(lineProject({ ...CHUCK, enabled: false }));
    expect(disabled.gcode).toBe(absent.gcode);
    expect(disabled.preflight.ok).toBe(true);
  });

  it('scales emitted Y by the chuck ratio, rebased to start at 0', () => {
    const plain = emitGcode(lineProject(undefined));
    const rotary = emitGcode(lineProject(CHUCK));
    expect(rotary.preflight.ok).toBe(true);
    // Design Y extent 50 surface mm → 50 · 360/(π·60) ≈ 95.493 machine mm,
    // rebased so the job's lowest Y is 0 (rotation is relative — the flat-bed
    // position of the artwork is meaningless on a rotary).
    expect(rotary.gcode).not.toBe(plain.gcode);
    const scaledExtent = 50 * (360 / (Math.PI * 60));
    expect(rotary.gcode).toContain(`Y${scaledExtent.toFixed(3)}`);
    expect(rotary.gcode).toContain('Y0.000');
    // X words match the plain emit (X untouched).
    const xWords = (g: string) => g.match(/X[\d.]+/g) ?? [];
    expect(xWords(rotary.gcode)).toEqual(xWords(plain.gcode));
  });

  it('roller keeps surface distances 1:1, rebased to start at 0', () => {
    const roller: RotarySetup = { ...CHUCK, type: 'roller', objectDiameterMm: 200 };
    const rotary = emitGcode(lineProject(roller, 50));
    expect(rotary.preflight.ok).toBe(true);
    // Scale 1: the 50 mm surface extent stays 50 mm, starting at Y0.
    expect(rotary.gcode).toContain('Y0.000');
    expect(rotary.gcode).toContain('Y50.000');
  });

  it('refuses a job taller than one revolution (wrap)', () => {
    // Chuck d=20: circumference ≈ 62.8 surface mm; a 100 mm design wraps.
    const small: RotarySetup = { ...CHUCK, objectDiameterMm: 20 };
    const result = emitGcode(lineProject(small, 100));
    expect(result.preflight.ok).toBe(false);
    expect(result.preflight.issues.some((i) => i.code === 'out-of-bed')).toBe(true);
  });

  it('emits non-empty rotary raster output without workstation-local permission', () => {
    const project = rotaryRasterProject();
    const defaultResult = emitGcode(project);
    expect(defaultResult.gcode).not.toBe('');
    expect(defaultResult.preflight.issues).toEqual([]);

    const result = defaultResult;
    expect(result.preflight.issues).toEqual([]);
    expect(result.preflight.ok).toBe(true);
    const yValues = [...result.gcode.matchAll(/Y(-?\d+(?:\.\d+)?)/g)].map((match) =>
      Number(match[1]),
    );
    expect(yValues.length).toBeGreaterThan(1);
    expect(Math.min(...yValues)).toBeCloseTo(0, 3);
    expect(Math.max(...yValues)).toBeGreaterThan(15);
    expect(Math.max(...yValues)).toBeLessThanOrEqual(10 * (360 / (Math.PI * 60)));
  });

  it('keeps mixed vector and raster rotary output non-empty', () => {
    const result = emitGcode(rotaryRasterProject(true));

    expect(result.preflight.ok).toBe(true);
    expect(result.gcode).not.toBe('');
    expect(result.gcode).toContain('L1');
    expect(result.gcode).toContain('L2');
  });
});
