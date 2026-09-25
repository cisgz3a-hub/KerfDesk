// The ADR-044 speed x power Material Test, now one fixed pair of axes on the
// ADR-381 generator: rows step speed from fastest to slowest, columns step
// power from weakest to strongest, in Fill mode with the layer defaults. Its
// output stays byte-identical to the original generator
// (material-test-grid.byte-identity.test.ts).

import { LAYER_DEFAULTS, type Bounds, type Scene } from '../scene';
import { clampMaterialTestPower, clampMaterialTestSpeed } from './material-test-axes';
import {
  generateMaterialTestAxesGrid,
  type MaterialTestAxesGridOptions,
} from './material-test-axes-grid';

export type MaterialTestGridOptions = {
  readonly rows: number;
  readonly columns: number;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly powerMin: number;
  readonly powerMax: number;
  /** Active profile compile ceiling. Omit only for profile-agnostic callers. */
  readonly maxFeedMmPerMin?: number;
  readonly cellWidthMm: number;
  readonly cellHeightMm: number;
  readonly gapMm?: number;
  readonly origin?: {
    readonly x: number;
    readonly y: number;
  };
};

export type MaterialTestCell = {
  readonly row: number;
  readonly column: number;
  readonly objectId: string;
  readonly layerId: string;
  /** Feed the compiler will emit for this cell. */
  readonly speed: number;
  readonly requestedSpeed: number;
  readonly effectiveSpeed: number;
  readonly power: number;
  readonly powerScale: number;
  readonly bounds: Bounds;
};

export type MaterialTestGrid = {
  readonly scene: Scene;
  readonly cells: ReadonlyArray<MaterialTestCell>;
};

export function generateMaterialTestGrid(options: MaterialTestGridOptions): MaterialTestGrid {
  const grid = generateMaterialTestAxesGrid(speedPowerAxes(options));
  return {
    scene: grid.scene,
    cells: grid.cells.map((cell) => ({
      row: cell.row,
      column: cell.column,
      objectId: cell.objectId,
      layerId: cell.layerId,
      speed: cell.speed,
      requestedSpeed: cell.requestedSpeed,
      effectiveSpeed: cell.effectiveSpeed,
      power: cell.power,
      powerScale: cell.powerScale,
      bounds: cell.bounds,
    })),
  };
}

// Min/max may arrive in either order; speed rows always run fastest first and
// power columns weakest first, whichever field holds the larger number.
function speedPowerAxes(options: MaterialTestGridOptions): MaterialTestAxesGridOptions {
  const speeds = [
    clampMaterialTestSpeed(options.speedMin),
    clampMaterialTestSpeed(options.speedMax),
  ];
  const powers = [
    clampMaterialTestPower(options.powerMin),
    clampMaterialTestPower(options.powerMax),
  ];
  return {
    mode: 'fill',
    rowAxis: {
      parameter: 'speed',
      start: Math.max(...speeds),
      end: Math.min(...speeds),
      count: options.rows,
    },
    columnAxis: {
      parameter: 'power',
      start: Math.min(...powers),
      end: Math.max(...powers),
      count: options.columns,
    },
    base: {
      power: LAYER_DEFAULTS.power,
      speed: LAYER_DEFAULTS.speed,
      passes: LAYER_DEFAULTS.passes,
      intervalMm: LAYER_DEFAULTS.hatchSpacingMm,
      airAssist: LAYER_DEFAULTS.airAssist,
      ditherAlgorithm: LAYER_DEFAULTS.ditherAlgorithm,
    },
    ...(options.maxFeedMmPerMin === undefined ? {} : { maxFeedMmPerMin: options.maxFeedMmPerMin }),
    cellWidthMm: options.cellWidthMm,
    cellHeightMm: options.cellHeightMm,
    ...(options.gapMm === undefined ? {} : { gapMm: options.gapMm }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  };
}
