// Real CNC artwork shared by omission/review regressions. The closed square
// fits the shipped 1/8-inch end mill; the two remote strokes cannot pocket.
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncCutType,
  type ImportedSvg,
  type Layer,
  type Project,
  type ReliefObject,
} from '../core/scene';
import { testReliefHeightfield } from './relief-heightfield';

export const CNC_OMISSION_LAYER_ID = 'pocket-main';
export const CNC_OMISSION_COLOR = '#000000';

export function cncOmissionArtwork(id: string, closed: boolean, x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: x, minY: 10, maxX: x + 10, maxY: 20 },
    paths: [
      {
        color: CNC_OMISSION_COLOR,
        polylines: [
          {
            closed,
            points: closed
              ? [
                  { x, y: 10 },
                  { x: x + 10, y: 10 },
                  { x: x + 10, y: 20 },
                  { x, y: 20 },
                ]
              : [
                  { x, y: 10 },
                  { x: x + 10, y: 10 },
                ],
          },
        ],
      },
    ],
  };
}

export const CNC_OMISSION_CLOSED = cncOmissionArtwork('closed-square', true, 10);
export const CNC_OMISSION_OPEN_A = cncOmissionArtwork('open-letter-a', false, 40);
export const CNC_OMISSION_OPEN_B = cncOmissionArtwork('open-letter-b', false, 65);

export function cncOmissionLayer(cutType: CncCutType = 'pocket', output = true): Layer {
  return {
    ...createLayer({
      id: CNC_OMISSION_LAYER_ID,
      name: CNC_OMISSION_LAYER_ID,
      color: CNC_OMISSION_COLOR,
    }),
    output,
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType,
      depthMm: 1,
      depthPerPassMm: 1,
      tabsEnabled: false,
    },
  };
}

export function cncOmissionProject(
  objects: ReadonlyArray<ImportedSvg> = [
    CNC_OMISSION_CLOSED,
    CNC_OMISSION_OPEN_A,
    CNC_OMISSION_OPEN_B,
  ],
  cutType: CncCutType = 'pocket',
  output = true,
): Project {
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [...objects], layers: [cncOmissionLayer(cutType, output)] },
  };
}

export function cncOmissionRelief(operationId = CNC_OMISSION_LAYER_ID): ReliefObject {
  return {
    kind: 'relief',
    id: 'assigned-relief',
    source: 'c1-floor.png',
    operationIds: [operationId],
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      maxDepthMm: 1,
      samplesU8: [0],
    }),
    targetWidthMm: 20,
    reliefDepthMm: 1,
    color: CNC_OMISSION_COLOR,
    bounds: { minX: 100, minY: 10, maxX: 120, maxY: 30 },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 10 },
  };
}
