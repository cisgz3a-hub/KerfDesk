// Alignment invariance for the registration jig (ADR-057, safety-critical).
// The jig burns in two runs (box outline, then artwork). The defining property:
// BOTH runs must anchor to the BOX, so the artwork keeps its position relative to
// the box instead of re-anchoring to its own bounds and landing at the bed corner.
// Without the box-anchored placement, the art run would offset by -art.frontLeft
// (A1 and A4 below would fail).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeJobBounds,
  computeRegistrationBoxBounds,
  computeSceneOutputBounds,
  USER_ORIGIN_JOB_PLACEMENT,
} from '../../core/job';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { prepareOutput } from './prepare-output';

const ART_COLOR = '#00cc44';

type Geom = {
  readonly bx: number;
  readonly by: number;
  readonly bw: number;
  readonly bh: number;
  readonly ax: number;
  readonly ay: number;
  readonly aw: number;
  readonly ah: number;
};

function artObject(x: number, y: number, w: number, h: number): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: w, maxY: h },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [
      {
        color: ART_COLOR,
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: w, y: 0 },
              { x: w, y: h },
              { x: 0, y: h },
              { x: 0, y: 0 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function jigProject(g: Geom, runs: { boxOutput: boolean; artOutput: boolean }): Project {
  const base = createProject();
  let scene: Scene = addObject(
    base.scene,
    createRegistrationBox({ widthMm: g.bw, heightMm: g.bh, x: g.bx, y: g.by }),
  );
  scene = addObject(scene, artObject(g.ax, g.ay, g.aw, g.ah));
  scene = addLayer(scene, { ...createRegistrationLayer(), output: runs.boxOutput });
  scene = addLayer(scene, {
    ...createLayer({ id: ART_COLOR, color: ART_COLOR }),
    output: runs.artOutput,
  });
  return { ...base, scene };
}

const geomArb: fc.Arbitrary<Geom> = fc.record({
  bx: fc.integer({ min: 0, max: 120 }),
  by: fc.integer({ min: 0, max: 120 }),
  bw: fc.integer({ min: 5, max: 100 }),
  bh: fc.integer({ min: 5, max: 100 }),
  ax: fc.integer({ min: 0, max: 120 }),
  ay: fc.integer({ min: 0, max: 120 }),
  aw: fc.integer({ min: 5, max: 60 }),
  ah: fc.integer({ min: 5, max: 60 }),
});

describe('registration jig placement — alignment invariance', () => {
  it('anchors both burn runs to the box, preserving artwork position relative to the box', () => {
    fc.assert(
      fc.property(geomArb, (g) => {
        const boxRun = jigProject(g, { boxOutput: true, artOutput: false });
        const artRun = jigProject(g, { boxOutput: false, artOutput: true });
        const preparedBox = prepareOutput(boxRun, { jobOrigin: USER_ORIGIN_JOB_PLACEMENT });
        const preparedArt = prepareOutput(artRun, { jobOrigin: USER_ORIGIN_JOB_PLACEMENT });
        expect(preparedBox.ok).toBe(true);
        expect(preparedArt.ok).toBe(true);
        if (!preparedBox.ok || !preparedArt.ok) return;

        const boxMachine = computeRegistrationBoxBounds(boxRun.scene, boxRun.device);
        const artMachine = computeSceneOutputBounds(artRun.scene, artRun.device);
        const artPlaced = computeJobBounds(preparedArt.job);
        if (boxMachine === null || artMachine === null || artPlaced === null) {
          throw new Error('expected non-null bounds for a jig scene with artwork');
        }

        // A1 — both runs receive the SAME box-anchored offset.
        expect(preparedArt.jobOriginOffset).toEqual(preparedBox.jobOriginOffset);

        // A2 — front-left user origin anchors the BOX to work-zero (0,0).
        expect(preparedBox.jobOriginOffset.x).toBeCloseTo(-boxMachine.minX, 6);
        expect(preparedBox.jobOriginOffset.y).toBeCloseTo(-boxMachine.minY, 6);

        // A4 — artwork lands at its offset RELATIVE TO THE BOX, not at the corner.
        expect(artPlaced.minX).toBeCloseTo(artMachine.minX - boxMachine.minX, 6);
        expect(artPlaced.minY).toBeCloseTo(artMachine.minY - boxMachine.minY, 6);
      }),
    );
  });

  it('places artwork off-origin when it sits away from the box corner', () => {
    // Concrete discriminator: box at (10,20), art at (100,100). Without
    // box-anchored placement the art run would re-anchor the art to (0,0).
    const g: Geom = { bx: 10, by: 20, bw: 80, bh: 40, ax: 100, ay: 100, aw: 10, ah: 10 };
    const artRun = jigProject(g, { boxOutput: false, artOutput: true });
    const prepared = prepareOutput(artRun, { jobOrigin: USER_ORIGIN_JOB_PLACEMENT });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const artPlaced = computeJobBounds(prepared.job);
    const boxMachine = computeRegistrationBoxBounds(artRun.scene, artRun.device);
    const artMachine = computeSceneOutputBounds(artRun.scene, artRun.device);
    if (artPlaced === null || boxMachine === null || artMachine === null) {
      throw new Error('expected non-null bounds');
    }
    expect(artPlaced.minX).toBeCloseTo(artMachine.minX - boxMachine.minX, 6);
    expect(artPlaced.minY).toBeCloseTo(artMachine.minY - boxMachine.minY, 6);
    // And the art is NOT anchored to the corner (proves it isn't self-anchored).
    expect(Math.abs(artPlaced.minX) + Math.abs(artPlaced.minY)).toBeGreaterThan(0);
  });
});
