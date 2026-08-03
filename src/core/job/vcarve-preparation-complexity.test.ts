// The defect in one file: every responsiveness gate measured input size, and
// V-carve is the one cut type whose cost is not a function of input size. A
// four-point square scores nothing against every segment budget and still
// costs seconds to prepare, so selecting the cut type froze the app.
import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type CncCutType,
  type Scene,
  type TracedImage,
} from '../scene';
import {
  countEstimatedFillSegments,
  countOutputVectorSegments,
  outputVectorPreparationTooComplex,
} from './preparation-complexity';
import { sceneHasVCarveOutputLayer } from './vcarve-preparation-complexity';

function square(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'square-1',
    source: 'square.png',
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

function sceneWith(cutType: CncCutType, isOutput = true): Scene {
  return {
    ...EMPTY_SCENE,
    layers: [
      {
        ...createLayer({ id: '#000000', color: '#000000', mode: 'line' }),
        output: isOutput,
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType },
      },
    ],
    objects: [square()],
  };
}

describe('sceneHasVCarveOutputLayer', () => {
  it('flags a V-carve output layer', () => {
    expect(sceneHasVCarveOutputLayer(sceneWith('v-carve'))).toBe(true);
  });

  it('ignores cut types whose cost tracks their input', () => {
    expect(sceneHasVCarveOutputLayer(sceneWith('pocket'))).toBe(false);
    expect(sceneHasVCarveOutputLayer(sceneWith('profile-outside'))).toBe(false);
    expect(sceneHasVCarveOutputLayer(sceneWith('profile-on-path'))).toBe(false);
  });

  it('ignores a V-carve layer that produces no output', () => {
    expect(sceneHasVCarveOutputLayer(sceneWith('v-carve', false))).toBe(false);
  });

  it('ignores a scene with no CNC settings at all', () => {
    expect(sceneHasVCarveOutputLayer(EMPTY_SCENE)).toBe(false);
  });
});

describe('outputVectorPreparationTooComplex with a V-carve layer', () => {
  it('reports over-budget even though every segment counter says trivial', () => {
    const scene = sceneWith('v-carve');
    const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG, scene };

    // The bug this fixes: the counters see a four-point square...
    expect(countOutputVectorSegments(scene)).toBeLessThan(100);
    expect(countEstimatedFillSegments(scene)).toBe(0);
    // ...and preparation still costs seconds, so Save, the G-code 3D view and
    // Job Review must all take the worker instead of the main thread.
    expect(outputVectorPreparationTooComplex(project)).toBe(true);
  });

  it('leaves an equally small non-amplifying scene on the fast path', () => {
    const project = {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: sceneWith('pocket'),
    };
    expect(outputVectorPreparationTooComplex(project)).toBe(false);
  });
});
