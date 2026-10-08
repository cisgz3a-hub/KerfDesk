import type { HeightfieldReliefObject } from '../core/scene/scene-object';
import type { ReliefComponent } from '../core/scene/relief/relief-authoring';
import { IDENTITY_TRANSFORM, type Project } from '../core/scene';
import { createBlankReliefAuthoringDocument } from '../core/relief/relief-authoring-document';
import { materializeReliefAuthoring } from '../core/relief/materialize-relief-authoring';
import {
  benchmarkProject,
  benchmarkLayer,
  benchmarkRectangle,
  benchmarkVector,
} from './cnc-leader-fixtures';
export function reliefBenchmark(): Project {
  const base = benchmarkProject(),
    border = benchmarkVector('clipped-border', [benchmarkRectangle(0, 0, 24, 20)], []);
  const ornament = benchmarkVector('ornament', [benchmarkRectangle(3, 3, 18, 14)], []);
  const component: ReliefComponent = {
    id: 'dome',
    name: 'Linked dome',
    levelId: 'level-1',
    visible: true,
    combineMode: 'max',
    transform: IDENTITY_TRANSFORM,
    baseHeightMm: 0,
    heightScale: 1,
    source: {
      kind: 'vector-shape-v1',
      boundary: { linkedObjectId: ornament.id, rings: ornament.paths[0]?.polylines ?? [] },
      profile: 'dome',
      heightMm: 3,
      angleDeg: 0,
    },
  };
  const document = {
    ...createBlankReliefAuthoringDocument({
      width: 24,
      height: 20,
      physicalWidthMm: 24,
      physicalHeightMm: 20,
      maxDepthMm: 4,
    }),
    components: [component],
    clip: { linkedObjectId: border.id, rings: border.paths[0]?.polylines ?? [] },
  };
  const built = materializeReliefAuthoring(document);
  if (built.kind !== 'ok') throw new Error('Relief benchmark materialization failed.');
  const relief: HeightfieldReliefObject = {
    kind: 'relief',
    id: 'plaque',
    source: 'Dome plaque',
    color: '#000000',
    operationIds: ['relief'],
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 24, maxY: 20 },
    targetWidthMm: 24,
    reliefDepthMm: 4,
    reliefSource: built.field,
    reliefAuthoring: document,
  };
  const letters = benchmarkVector(
    'surface-letter',
    [
      {
        closed: false,
        points: [
          { x: 7, y: 5 },
          { x: 7, y: 15 },
          { x: 12, y: 10 },
          { x: 17, y: 15 },
        ],
      },
      {
        closed: false,
        points: [
          { x: 12, y: 10 },
          { x: 17, y: 5 },
        ],
      },
    ],
    ['projected-letter'],
  );
  return {
    ...base,
    scene: {
      layers: [
        benchmarkLayer('relief', {
          cutType: 'pocket',
          depthMm: 4,
          toolId: 'end6',
          reliefFinishToolId: 'ball2',
          reliefScallopMm: 0.2,
          reliefFineStepMm: 1,
          reliefRestFinishToolId: 'ball1',
          reliefRestResidualMm: 0.1,
          reliefRestScallopMm: 0.1,
        }),
        benchmarkLayer('projected-letter', {
          cutType: 'engrave',
          toolId: 'ball1',
          reliefProjection: {
            reliefObjectId: 'plaque',
            depthMm: 0.15,
            depthConvention: 'vertical',
            sampleSpacingMm: 0.5,
          },
        }),
      ],
      objects: [relief, ornament, border, letters],
    },
  };
}
