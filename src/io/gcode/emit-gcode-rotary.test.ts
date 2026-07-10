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

// ADR-127 N1: rotary Y scaling applies at emit, wrap-taller jobs and raster
// jobs are refused, and disabled rotary output is byte-identical.

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

  it('refuses raster jobs while the rotary is enabled', () => {
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
    } as SceneObject;
    const base = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: CHUCK });
    const project: Project = {
      ...base,
      scene: addLayer(
        addObject(base.scene, raster),
        createLayer({ id: 'L1', color, mode: 'image' }),
      ),
    };
    const result = emitGcode(project);
    expect(result.preflight.ok).toBe(false);
    expect(result.preflight.issues[0]?.code).toBe('rotary-raster-unsupported');
    expect(result.gcode).toBe('');
  });
});
