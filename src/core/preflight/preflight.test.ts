import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob } from '../job';
import { grblStrategy } from '../output';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../scene';
import { runPreflight } from './preflight';

function emit(project: Project): string {
  return grblStrategy.emit(compileJob(project.scene, project.device), project.device);
}

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'a.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function projectWith(...layers: ReturnType<typeof createLayer>[]): Project {
  return {
    ...createProject(),
    scene: { ...EMPTY_SCENE, objects: [sampleObject], layers },
  };
}

describe('runPreflight — happy path', () => {
  it('returns ok=true with no issues for a well-formed project', () => {
    const project = projectWith(createLayer({ id: 'L1', color: '#ff0000' }));
    const result = runPreflight(project, emit(project));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags image minPower above layer power before output is burned', () => {
    const layer = {
      ...createLayer({ id: 'L1', color: '#ff0000', mode: 'image' }),
      minPower: 40,
      power: 30,
    };
    const project = projectWith(layer);

    const result = runPreflight(project, emit(project));

    expect(result.issues).toContainEqual({
      code: 'power-out-of-range',
      message: 'Layer L1 min power 40 exceeds max power 30.',
    });
  });
});

describe('runPreflight laser-off travel invariant', () => {
  it('flags G0 travel while the laser may still be armed', () => {
    const project = projectWith(createLayer({ id: 'L1', color: '#ff0000' }));
    const unsafeGcode = [
      'G21',
      'G90',
      'M3 S0',
      'G1 X1.000 Y1.000 S500',
      'G0 X5.000 Y5.000',
      'G1 X9.000 Y9.000 S500',
      'M5',
    ].join('\n');

    const result = runPreflight(project, unsafeGcode);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      code: 'laser-on-travel',
      message: 'Line 5: G0 without S0 and no preceding M5 / sticky S0',
    });
  });
});

describe('runPreflight long blank-feed invariant', () => {
  it('flags a long G1 S0 blank-feed move (stale or regressed output)', () => {
    const project = projectWith(createLayer({ id: 'L1', color: '#ff0000' }));
    // A 20 mm laser-off cutting-feed move — the stray-line / stale-export class
    // ADR-035 eliminated from fresh output.
    const staleGcode = [
      'G21',
      'G90',
      'M3 S0',
      'G1 X1.000 Y1.000 F1500 S300',
      'G1 X21.000 Y1.000 S0',
      'M5',
    ].join('\n');

    const result = runPreflight(project, staleGcode);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      code: 'long-blank-feed',
      message:
        'Line 5: blank G1 feed move 20.000 mm exceeds 5.000 mm. Regenerate output or lower the fill blank-feed threshold after hardware verification.',
    });
  });

  it('does not flag fresh output whose blank gaps are at or below 5 mm (ADR-035)', () => {
    const project = projectWith(createLayer({ id: 'L1', color: '#ff0000' }));
    const freshGcode = [
      'G21',
      'G90',
      'M3 S0',
      'G1 X1.000 Y1.000 F1500 S300',
      'G1 X5.000 Y1.000 S0', // 4 mm blank gap — under the 5 mm threshold
      'G1 X10.000 Y1.000 S300',
      'M5',
    ].join('\n');

    const result = runPreflight(project, freshGcode);

    expect(result.issues.every((i) => i.code !== 'long-blank-feed')).toBe(true);
  });
});

describe('runPreflight — F-A10 check 1: no output layer', () => {
  it('flags no-output-layer when zero layers have output=true', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), output: false };
    const project = projectWith(layer);
    const result = runPreflight(project, emit(project));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('no-output-layer');
  });
});

describe('runPreflight — F-A10 check 3: power out of range', () => {
  it('flags layers with power < 0 or > 100', () => {
    const high = { ...createLayer({ id: 'H', color: '#ff0000' }), power: 200 };
    const low = { ...createLayer({ id: 'L', color: '#00ff00' }), power: -5 };
    const project = projectWith(high, low);
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    // Two layers, two power issues.
    expect(codes.filter((c) => c === 'power-out-of-range')).toHaveLength(2);
  });
});

describe('runPreflight — F-A10 check 4: speed out of range', () => {
  it('flags layers with speed > device.maxFeed', () => {
    const project = projectWith({
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      speed: DEFAULT_DEVICE_PROFILE.maxFeed + 1,
    });
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('speed-out-of-range');
  });

  it('flags layers with speed <= 0', () => {
    const project = projectWith({
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      speed: 0,
    });
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('speed-out-of-range');
  });
});

describe('runPreflight — F-A10 check 5: passes < 1', () => {
  it('flags non-integer passes', () => {
    const project = projectWith({
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      passes: 1.5,
    });
    expect(runPreflight(project, emit(project)).issues.map((i) => i.code)).toContain(
      'passes-below-one',
    );
  });

  it('flags zero passes', () => {
    const project = projectWith({
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      passes: 0,
    });
    expect(runPreflight(project, emit(project)).issues.map((i) => i.code)).toContain(
      'passes-below-one',
    );
  });
});

describe('runPreflight — F-A10 check 6: empty output', () => {
  it('flags empty-output when no G1 lines exist', () => {
    const project = createProject();
    const result = runPreflight(project, emit(project));
    // Empty project has no output layers (different check) AND no G1 lines.
    expect(result.issues.map((i) => i.code)).toContain('empty-output');
  });
});

describe('runPreflight — F-A10 check 2: bounds', () => {
  it('flags out-of-bed coords (objects translated past bedWidth)', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const outOfBedObj: SceneObject = {
      ...sampleObject,
      transform: { ...IDENTITY_TRANSFORM, x: 1000 }, // far outside 400×400 bed
    };
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [outOfBedObj], layers: [layer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('out-of-bed');
  });

  it('flags center-origin output beyond the centered machine rectangle', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const outOfBedObj: SceneObject = {
      ...sampleObject,
      transform: { ...IDENTITY_TRANSFORM, x: 410 },
    };
    const project: Project = {
      ...createProject(),
      device: { ...DEFAULT_DEVICE_PROFILE, origin: 'center' },
      scene: { ...EMPTY_SCENE, objects: [outOfBedObj], layers: [layer] },
    };
    const result = runPreflight(project, emit(project));

    expect(result.issues.map((i) => i.code)).toContain('out-of-bed');
    expect(result.issues.find((i) => i.code === 'out-of-bed')?.message).toMatch(/X out of bed/);
  });

  it('flags fill overscan lead-in moves that leave the bed', () => {
    const layer = {
      ...createLayer({ id: 'L-fill', color: '#ff0000', mode: 'fill' }),
      fillOverscanMm: 5,
      hatchSpacingMm: 2,
    };
    const nearLeftEdge: SceneObject = {
      kind: 'imported-svg',
      id: 'O-fill',
      source: 'fill.svg',
      bounds: { minX: 1, minY: 1, maxX: 21, maxY: 9 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 1, y: 1 },
                { x: 21, y: 1 },
                { x: 21, y: 9 },
                { x: 1, y: 9 },
              ],
            },
          ],
        },
      ],
    };
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [nearLeftEdge], layers: [layer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('out-of-bed');
  });
});

describe('runPreflight — F4: layer-mode-mismatch (silent compile drop)', () => {
  const blueVector: SceneObject = {
    kind: 'imported-svg',
    id: 'O-blue',
    source: 'b.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#0000ff',
        polylines: [
          {
            points: [
              { x: 1, y: 1 },
              { x: 9, y: 9 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };

  const grayRaster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };

  it('flags a vector object whose color maps to an Image-mode layer', () => {
    // The red vector on a Line layer emits fine; the blue vector lands on an
    // Image-mode layer, which compileJob only feeds raster images — so the
    // blue vector silently produces no G-code. The red cut keeps the job
    // non-empty, isolating this from the empty-output check.
    const lineLayer = createLayer({ id: 'L-red', color: '#ff0000' });
    const imageLayer = createLayer({ id: 'L-blue', color: '#0000ff', mode: 'image' });
    const project: Project = {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [sampleObject, blueVector],
        layers: [lineLayer, imageLayer],
      },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('layer-mode-mismatch');
    expect(codes).not.toContain('empty-output');
  });

  it('flags a raster image whose color maps to a Line/Fill-mode layer', () => {
    const lineLayer = createLayer({ id: 'L-gray', color: '#808080' });
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [grayRaster], layers: [lineLayer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('layer-mode-mismatch');
  });

  it('does not flag correctly-matched objects (vector on Line, raster on Image)', () => {
    const lineLayer = createLayer({ id: 'L-red', color: '#ff0000' });
    const imageLayer = createLayer({ id: 'L-gray', color: '#808080', mode: 'image' });
    const project: Project = {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [sampleObject, grayRaster],
        layers: [lineLayer, imageLayer],
      },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).not.toContain('layer-mode-mismatch');
  });

  it('flags a rotated raster image because raster emit is axis-aligned', () => {
    const imageLayer = createLayer({ id: 'L-gray', color: '#808080', mode: 'image' });
    const rotatedRaster: SceneObject = {
      ...grayRaster,
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [rotatedRaster], layers: [imageLayer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('unsupported-raster-transform');
  });

  it('does not block on rotated trace-source backing images', () => {
    const imageLayer = createLayer({ id: 'L-gray', color: '#808080', mode: 'image' });
    const traceSource: SceneObject = {
      ...grayRaster,
      role: 'trace-source',
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };
    const traceLayer = createLayer({ id: 'L-black', color: '#000000', mode: 'fill' });
    const traced: SceneObject = {
      kind: 'traced-image',
      id: 'T1',
      source: 'x.png',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 1, y: 1 },
                { x: 9, y: 1 },
                { x: 9, y: 9 },
                { x: 1, y: 9 },
              ],
            },
          ],
        },
      ],
    };
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [traceSource, traced], layers: [imageLayer, traceLayer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).not.toContain('unsupported-raster-transform');
    expect(codes).not.toContain('layer-mode-mismatch');
  });
});
