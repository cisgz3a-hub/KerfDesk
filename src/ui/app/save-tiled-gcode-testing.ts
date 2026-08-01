import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TILING,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';

const SQUARE_SIZE_MM = 20;
const FIRST_OBJECT_OFFSET_MM = 10;
const SECOND_OBJECT_OFFSET_MM = 60;
const OVER_BUDGET_TILE_SIZE_MM = 20;
const OVER_BUDGET_OVERLAP_MM = 100;
// eslint-disable-next-line no-restricted-syntax -- scene DATA: fixture layer/object color key, not UI chrome (ADR-047).
const FIRST_LAYER_COLOR = '#ff0000';
// eslint-disable-next-line no-restricted-syntax -- scene DATA: fixture layer/object color key, not UI chrome (ADR-047).
const SECOND_LAYER_COLOR = '#0000ff';

function squareObject(id: string, color: string, at: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: at,
      minY: at,
      maxX: at + SQUARE_SIZE_MM,
      maxY: at + SQUARE_SIZE_MM,
    },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: at },
              { x: at + SQUARE_SIZE_MM, y: at },
              { x: at + SQUARE_SIZE_MM, y: at + SQUARE_SIZE_MM },
              { x: at, y: at + SQUARE_SIZE_MM },
            ],
          },
        ],
      },
    ],
  };
}

/** Build the two-layer CNC project shared by tiled Save tests. */
export function tiledCncProject(): Project {
  const base = createProject();
  return {
    ...base,
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tiling: DEFAULT_CNC_TILING },
    scene: {
      objects: [
        squareObject('O1', FIRST_LAYER_COLOR, FIRST_OBJECT_OFFSET_MM),
        squareObject('O2', SECOND_LAYER_COLOR, SECOND_OBJECT_OFFSET_MM),
      ],
      layers: [
        {
          ...createLayer({ id: 'L1', color: FIRST_LAYER_COLOR }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' },
        },
        {
          ...createLayer({ id: 'L2', color: SECOND_LAYER_COLOR }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' },
        },
      ],
    },
  };
}

/** Capture every picker request and string written through the tiled Save path. */
export function capturingPlatform(written: string[], pickedNames: string[] = []): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => {
      pickedNames.push('tile.gcode');
      return {
        displayName: 'tile.gcode',
        write: async (data: string | Blob) => {
          if (typeof data === 'string') written.push(data);
        },
      };
    },
    serial: { isSupported: () => false },
    // The tiled Save path touches only pickFileForSave.
  } as unknown as PlatformAdapter;
}

/** Give a CNC project a small, degenerate grid for tiled Save integration tests. */
export function withOverBudgetTiling(project: Project): Project {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC project');
  return {
    ...project,
    machine: {
      ...machine,
      tiling: {
        tileWidthMm: OVER_BUDGET_TILE_SIZE_MM,
        tileHeightMm: OVER_BUDGET_TILE_SIZE_MM,
        overlapMm: OVER_BUDGET_OVERLAP_MM,
        registrationHoles: false,
      },
    },
  };
}
