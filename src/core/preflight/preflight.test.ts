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
});
