import { describe, expect, it } from 'vitest';
import { testAuthoringRelief } from '../../__fixtures__/relief-authoring';
import { IDENTITY_TRANSFORM } from '../scene/scene-object';
import type {
  ReliefComponent,
  ReliefSculptStroke,
  ReliefVectorMask,
} from '../scene/relief/relief-authoring';
import {
  createBlankReliefAuthoringDocument,
  createReliefAuthoringDocument,
} from './relief-authoring-document';
import { reliefAuthoringError } from './relief-authoring-validation';
import { materializeReliefAuthoring } from './materialize-relief-authoring';
function polygon(): ReliefVectorMask {
  return {
    rings: [
      {
        closed: true,
        points: Array.from({ length: 128 }, (_, i) => ({
          x: 3 + 2 * Math.cos((i * Math.PI) / 64),
          y: 3 + 2 * Math.sin((i * Math.PI) / 64),
        })),
      },
    ],
  };
}
const component: ReliefComponent = {
  id: 'plane',
  name: 'Polygon plane',
  levelId: 'level-1',
  visible: true,
  combineMode: 'replace',
  transform: IDENTITY_TRANSFORM,
  baseHeightMm: 0,
  heightScale: 1,
  source: {
    kind: 'vector-shape-v1',
    boundary: polygon(),
    profile: 'plane',
    heightMm: 3,
    angleDeg: 0,
  },
};
describe('retained relief physical work admission', () => {
  it('counts polygon traversals and requires explicit grid reduction before raster allocation', () => {
    const doc = {
      ...createBlankReliefAuthoringDocument({
        width: 512,
        height: 512,
        physicalWidthMm: 6,
        physicalHeightMm: 6,
        maxDepthMm: 5,
      }),
      components: [component],
    };
    expect(materializeReliefAuthoring(doc)).toMatchObject({
      kind: 'error',
      reason: expect.stringContaining('work budget'),
    });
    expect(reliefAuthoringError({ ...doc, width: 128, height: 128 })).toBeNull();
  });
  it('includes masked smoothing neighbourhoods in the cumulative stroke work estimate', () => {
    const base = {
      ...createReliefAuthoringDocument(testAuthoringRelief().reliefSource),
      width: 64,
      height: 64,
    };
    const stroke: ReliefSculptStroke = {
      schemaVersion: 1,
      id: 'smooth',
      componentId: 'source-1',
      mode: 'smooth',
      points: [{ x: 3, y: 3 }],
      diameterMm: 6,
      strength: 0.5,
      flattenHeightMm: 2.5,
      region: polygon(),
    };
    expect(reliefAuthoringError({ ...base, strokes: [stroke] })).toBeNull();
    expect(
      materializeReliefAuthoring({
        ...base,
        strokes: Array.from({ length: 4 }, (_, i) => ({ ...stroke, id: 'smooth-' + i })),
      }),
    ).toMatchObject({ kind: 'error', reason: expect.stringContaining('work budget') });
  });
});
