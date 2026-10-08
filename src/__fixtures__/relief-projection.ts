import {
  testAuthoringRelief,
  testLinkedReliefDocument,
  testMaterializedRelief,
  testReliefBoundary,
} from './relief-authoring';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
} from '../core/scene';
import type { HeightfieldReliefObject, ImportedSvg } from '../core/scene/scene-object';
import type { Project } from '../core/scene/project';
import type { OutputScope } from '../core/scene/output-scope';
export const reliefProjectionSelection: OutputScope = {
  cutSelectedGraphics: true,
  useSelectionOrigin: false,
  selectedObjectIds: ['vector'],
};
export function reliefProjectionProject(): Project {
  const relief = testAuthoringRelief(),
    doc = testLinkedReliefDocument(relief);
  const target: HeightfieldReliefObject = {
    ...relief,
    operationIds: ['target'],
    reliefAuthoring: doc,
    reliefSource: testMaterializedRelief(doc),
  };
  const vector: ImportedSvg = {
    kind: 'imported-svg',
    id: 'vector',
    source: 'letter.svg',
    operationIds: ['engrave'],
    bounds: { minX: 1.5, minY: 1.5, maxX: 2.5, maxY: 1.5 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 1.5, y: 1.5 },
              { x: 2.5, y: 1.5 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: 'ball',
      tools: [{ id: 'ball', name: 'Ball', kind: 'ball-nose', diameterMm: 0.5 }],
    },
    scene: {
      objects: [
        target,
        { ...testReliefBoundary(), operationIds: [], transform: { ...IDENTITY_TRANSFORM, x: 3 } },
        { ...testReliefBoundary('mask'), operationIds: [] },
        vector,
      ],
      layers: [
        {
          ...createLayer({ id: 'engrave', color: '#000000', name: 'Projected lettering' }),
          output: true,
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'engrave',
            reliefProjection: {
              reliefObjectId: 'relief',
              depthMm: 0.2,
              depthConvention: 'vertical',
              sampleSpacingMm: 0.1,
            },
          },
        },
        {
          ...createLayer({ id: 'target', color: '#a0522d' }),
          output: false,
          cnc: DEFAULT_CNC_LAYER_SETTINGS,
        },
      ],
    },
  };
}
