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
