// Sort cuts last through the shipped composition (emitGcode: compile, place,
// optimize, emit): the emitted layer sections, the order the machine burns,
// change from cut-first to engraving-first.

import { describe, expect, it } from 'vitest';
import { artwork, operation } from '../../core/cut-order.test-support';
import { cutsLastOrder } from '../../core/cuts-last-order';
import { splitGcodeLayerSections } from '../../core/invariants';
import { frameBoundsSignature, machineSpaceJob } from '../../core/job';
import { computeFrameJobBounds, computeFrameJobMotionBounds } from '../../core/job/job-bounds';
import {
  createProject,
  EMPTY_SCENE,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';

function project(
  layers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
  artworkOrder?: ReadonlyArray<string>,
): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      layers,
      objects,
      ...(artworkOrder === undefined ? {} : { artworkOrder }),
    },
  };
}

function sortCutsLast(input: Project): Project {
  const sorted = cutsLastOrder(input.scene, input.optimization.layerPriority).sorted;
  if (sorted === null) throw new Error('expected Sort cuts last to reorder the job');
  return {
    ...input,
    scene: { ...input.scene, layers: sorted.layers, artworkOrder: sorted.artworkOrder },
  };
}

// The envelope Frame traces and Start checks (required-frame-readiness).
function frameSignature(input: Project): string {
  const prepared = prepareOutput(input);
  if (!prepared.ok) throw new Error('preparation failed');
  const job = machineSpaceJob(prepared.job, prepared.project.device, prepared.project.machine);
  const bounds =
    computeFrameJobMotionBounds(job, prepared.project.device) ??
    computeFrameJobBounds(job, prepared.project.device);
  if (bounds === null) throw new Error('job has no frame bounds');
  return frameBoundsSignature(bounds);
}

function sectionOrder(input: Project): ReadonlyArray<string> {
  const { gcode, preflight } = emitGcode(input);
  expect(preflight.ok).toBe(true);
  return splitGcodeLayerSections(gcode).map((section) => section.layerId);
}

const panel = artwork('panel', [
  { operationId: 'cut', rect: [0, 0, 50, 50] },
  { operationId: 'engrave', rect: [10, 10, 10, 10] },
]);

describe('emitGcode after Sort cuts last', () => {
  it('burns separate engraving artwork before the outline that frees the part', () => {
    const before = project(
      [operation('cut'), operation('engrave', 'fill')],
      [
        artwork('outline', [{ operationId: 'cut', rect: [0, 0, 50, 50] }]),
        artwork('logo', [{ operationId: 'engrave', rect: [10, 10, 10, 10] }]),
      ],
      ['outline', 'logo'],
    );

    expect(sectionOrder(before)).toEqual(['cut', 'engrave']);
    expect(sectionOrder(sortCutsLast(before))).toEqual(['engrave', 'cut']);
    // Sorting from Job Review keeps a completed Frame valid: same envelope.
    expect(frameSignature(sortCutsLast(before))).toBe(frameSignature(before));
  });

  it('burns an artwork’s own engraving before its outline', () => {
    const before = project([operation('cut'), operation('engrave', 'fill')], [panel]);

    expect(sectionOrder(before)).toEqual(['cut', 'engrave']);
    expect(sectionOrder(sortCutsLast(before))).toEqual(['engrave', 'cut']);
  });

  it('keeps the cut last when operations run bottom-up', () => {
    const base = project([operation('engrave', 'fill'), operation('cut')], [panel]);
    const before: Project = {
      ...base,
      optimization: { ...base.optimization, layerPriority: 'reverse-project-order' },
    };

    expect(sectionOrder(before)).toEqual(['cut', 'engrave']);
    expect(sectionOrder(sortCutsLast(before))).toEqual(['engrave', 'cut']);
  });
});
