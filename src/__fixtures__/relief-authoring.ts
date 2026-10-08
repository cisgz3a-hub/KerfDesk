import { testReliefHeightfield } from './relief-heightfield';
import {
  IDENTITY_TRANSFORM,
  type HeightfieldReliefObject,
  type ImportedSvg,
  type Polyline,
} from '../core/scene/scene-object';
import type {
  ReliefAuthoringDocument,
  ReliefVectorMask,
} from '../core/scene/relief/relief-authoring';
import {
  createReliefAuthoringDocument,
  reviseReliefDocument,
} from '../core/relief/relief-authoring-document';
import { materializeReliefAuthoring } from '../core/relief/materialize-relief-authoring';

export function testReliefBoundary(id = 'boundary', width = 6): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id + '.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: width, maxY: 6 },
    paths: [{ color: '#000000', polylines: [testReliefRectangle(width)] }],
  };
}
export function testReliefRectangle(width = 6): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: 6 },
      { x: 0, y: 6 },
    ],
  };
}
export function testAuthoringRelief(): HeightfieldReliefObject {
  const source = testReliefHeightfield({
    width: 6,
    height: 6,
    physicalWidthMm: 6,
    physicalHeightMm: 6,
    maxDepthMm: 5,
    samplesU16: Array.from({ length: 36 }, () => 10000),
  });
  return {
    kind: 'relief',
    id: 'relief',
    source: 'retained.png',
    color: '#a0522d',
    reliefSource: source,
    targetWidthMm: 6,
    reliefDepthMm: 5,
    bounds: { minX: 0, minY: 0, maxX: 6, maxY: 6 },
    transform: IDENTITY_TRANSFORM,
  };
}
export function testLinkedReliefDocument(relief = testAuthoringRelief()): ReliefAuthoringDocument {
  const original = createReliefAuthoringDocument(relief.reliefSource);
  const boundary: ReliefVectorMask = { rings: [testReliefRectangle()], linkedObjectId: 'boundary' };
  return reviseReliefDocument(original, {
    components: [
      ...original.components,
      {
        id: 'shape',
        name: 'Linked plane',
        levelId: 'level-1',
        visible: true,
        combineMode: 'max',
        transform: IDENTITY_TRANSFORM,
        baseHeightMm: 0,
        heightScale: 1,
        source: { kind: 'vector-shape-v1', boundary, profile: 'plane', heightMm: 3, angleDeg: 0 },
        mask: { ...boundary, linkedObjectId: 'mask' },
      },
    ],
  });
}
export function testMaterializedRelief(document: ReliefAuthoringDocument) {
  const result = materializeReliefAuthoring(document);
  if (result.kind !== 'ok') throw new Error(result.kind === 'error' ? result.reason : 'Cancelled');
  return result.field;
}
