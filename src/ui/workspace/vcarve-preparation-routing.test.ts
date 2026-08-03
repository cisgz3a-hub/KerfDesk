// Regression cover for the freeze that selecting V-carve caused: a V-carve
// layer amplifies a geometrically tiny scene into a large toolpath, so the raw
// segment budgets waved it onto the main thread and every later project change
// paid a multi-second synchronous prepare.
import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type CncCutType,
  type Project,
  type TracedImage,
} from '../../core/scene';
import { scenePreparationTooComplex } from '../../core/job';
import { cncVCarvePreparationTooComplex } from './vcarve-preparation-routing';

// A four-point closed contour: the whole point of the bug is that the input is
// trivially small while the V-carve toolpath built from it is not.
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

function cncScene(cutType: CncCutType, isOutput: boolean) {
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

function cncProject(cutType: CncCutType, isOutput = true): Project {
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: cncScene(cutType, isOutput),
  };
}

describe('cncVCarvePreparationTooComplex', () => {
  it('routes a V-carve layer off-thread even though the scene is tiny', () => {
    const project = cncProject('v-carve');

    // The bug in one assertion: the size-based gate sees nothing wrong...
    expect(scenePreparationTooComplex(project.scene)).toBe(false);
    // ...while the amplifying cut type is what actually costs seconds.
    expect(cncVCarvePreparationTooComplex(project)).toBe(true);
  });

  it('leaves non-amplifying CNC cut types on the synchronous path', () => {
    expect(cncVCarvePreparationTooComplex(cncProject('pocket'))).toBe(false);
    expect(cncVCarvePreparationTooComplex(cncProject('profile-outside'))).toBe(false);
  });

  it('ignores a V-carve layer that produces no output', () => {
    expect(cncVCarvePreparationTooComplex(cncProject('v-carve', false))).toBe(false);
  });

  it('never routes a machineless project off-thread for cut type', () => {
    const { machine: _machine, ...machineless } = cncProject('v-carve');
    expect(cncVCarvePreparationTooComplex(machineless)).toBe(false);
  });
});
