// Reads Material Tests back out of a project (ADR-381) so the operator can
// pick the best burned cell and reuse its settings. Each cell's settings are
// what the compiler would burn today: its operation, the cell's own override
// and its power scale. Tests generated before ADR-381 use the same ids, so
// they are found too.

import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from '../effective-output';
import {
  captureLayerOperationSettings,
  primaryOperationForObject,
  type LayerOperationSettings,
  type Scene,
  type SceneObject,
} from '../scene';
import {
  effectiveMaterialTestSpeed,
  MATERIAL_TEST_PARAMETERS,
  materialTestImageIntervalMm,
  type MaterialTestParameter,
} from './material-test-axes';
import { MATERIAL_TEST_SOURCE } from './material-test-axes-grid';

const CELL_ID = /^(.+)-cell-r(\d+)-c(\d+)$/;

export type MaterialTestCellResult = {
  readonly objectId: string;
  readonly row: number;
  readonly column: number;
  readonly operationId: string;
  /** Every setting the cell burns with, power already scaled for the cell. */
  readonly settings: LayerOperationSettings;
};

export type MaterialTestResult = {
  readonly prefix: string;
  readonly name: string;
  readonly rows: number;
  readonly columns: number;
  /** The setting that changes from row to row, when one does. */
  readonly rowParameter: MaterialTestParameter | null;
  readonly columnParameter: MaterialTestParameter | null;
  /** Row-major. */
  readonly cells: ReadonlyArray<MaterialTestCellResult>;
};

export function findMaterialTests(scene: Scene): ReadonlyArray<MaterialTestResult> {
  const byPrefix = new Map<string, MaterialTestCellResult[]>();
  for (const object of scene.objects) {
    const found = materialTestCell(object, scene);
    if (found === null) continue;
    const cells = byPrefix.get(found.prefix) ?? [];
    cells.push(found.cell);
    byPrefix.set(found.prefix, cells);
  }
  return [...byPrefix].map(([prefix, cells]) => materialTestResult(scene, prefix, cells));
}

/** The prefix of the test an object belongs to, or null for other artwork. */
export function materialTestPrefixOf(object: SceneObject): string | null {
  if (!('source' in object) || object.source !== MATERIAL_TEST_SOURCE) return null;
  return CELL_ID.exec(object.id)?.[1] ?? null;
}

/** The value an axis parameter has in a cell's settings; interval is in mm. */
export function materialTestSettingValue(
  settings: LayerOperationSettings,
  parameter: MaterialTestParameter,
): number | undefined {
  switch (parameter) {
    case 'power':
      return settings.power;
    case 'speed':
      return settings.speed;
    case 'passes':
      return settings.passes;
    case 'interval':
      if (settings.mode === 'fill') return settings.hatchSpacingMm;
      if (settings.mode === 'image') return materialTestImageIntervalMm(settings.linesPerMm);
      return undefined;
    default:
      return parameter satisfies never;
  }
}

/** A cell's settings with the feed it actually burned at (profile ceiling applied). */
export function materialTestBurnedSettings(
  cell: MaterialTestCellResult,
  maxFeedMmPerMin: number | undefined,
): LayerOperationSettings {
  return {
    ...cell.settings,
    speed: effectiveMaterialTestSpeed(cell.settings.speed, maxFeedMmPerMin),
  };
}

export type MaterialTestCellPatch = Partial<
  Pick<
    LayerOperationSettings,
    'power' | 'speed' | 'passes' | 'airAssist' | 'hatchSpacingMm' | 'linesPerMm' | 'ditherAlgorithm'
  >
>;

/**
 * What "Apply to operation" writes: the burned settings the target's mode
 * uses. The operation keeps its mode and everything the test did not
 * exercise (min power, fill angle, overscan, tabs...). A line interval only
 * carries over between operations of the test's own mode.
 */
export function materialTestCellPatch(
  burned: LayerOperationSettings,
  target: Pick<LayerOperationSettings, 'mode'>,
): { readonly patch: MaterialTestCellPatch; readonly intervalSkipped: boolean } {
  const common = {
    power: burned.power,
    speed: burned.speed,
    passes: burned.passes,
    airAssist: burned.airAssist,
  };
  if (burned.mode !== target.mode) {
    return { patch: common, intervalSkipped: burned.mode !== 'line' };
  }
  if (burned.mode === 'fill') {
    return { patch: { ...common, hatchSpacingMm: burned.hatchSpacingMm }, intervalSkipped: false };
  }
  if (burned.mode === 'image') {
    return {
      patch: { ...common, linesPerMm: burned.linesPerMm, ditherAlgorithm: burned.ditherAlgorithm },
      intervalSkipped: false,
    };
  }
  return { patch: common, intervalSkipped: false };
}

/**
 * Energy a cell put into the material relative to the others, for shading a
 * preview: power x passes per unit of feed, and per unit of line interval in
 * Fill and Image. It compares cells of one test; it is not a physical dose.
 */
export function materialTestRelativeEnergy(burned: LayerOperationSettings): number {
  const interval = materialTestSettingValue(burned, 'interval') ?? 1;
  return (burned.power * burned.passes) / (Math.max(burned.speed, 1) * Math.max(interval, 1e-3));
}

function materialTestCell(
  object: SceneObject,
  scene: Scene,
): { readonly prefix: string; readonly cell: MaterialTestCellResult } | null {
  const prefix = materialTestPrefixOf(object);
  const match = CELL_ID.exec(object.id);
  const operation = primaryOperationForObject(object, scene.layers);
  if (prefix === null || match === null || operation === null) return null;
  const effective = effectiveOperationForObject(operation, object);
  return {
    prefix,
    cell: {
      objectId: object.id,
      row: Number(match[2]),
      column: Number(match[3]),
      operationId: operation.id,
      settings: {
        ...captureLayerOperationSettings(effective),
        power: rounded(effectiveObjectPowerPercent(effective, object)),
        minPower: rounded(effectiveObjectMinPowerPercent(effective, object)),
      },
    },
  };
}

function materialTestResult(
  scene: Scene,
  prefix: string,
  unsorted: ReadonlyArray<MaterialTestCellResult>,
): MaterialTestResult {
  const cells = [...unsorted].sort((a, b) => a.row - b.row || a.column - b.column);
  const firstId = cells[0]?.objectId;
  const group = (scene.groups ?? []).find(
    (candidate) => firstId !== undefined && candidate.objectIds.includes(firstId),
  );
  return {
    prefix,
    name: group?.name ?? 'Material test',
    rows: Math.max(...cells.map((cell) => cell.row)) + 1,
    columns: Math.max(...cells.map((cell) => cell.column)) + 1,
    rowParameter: axisParameter(cells, 'row'),
    columnParameter: axisParameter(cells, 'column'),
    cells,
  };
}

// The row parameter changes from row to row (it differs inside a column) and
// holds still along each row; the column parameter is the transpose.
function axisParameter(
  cells: ReadonlyArray<MaterialTestCellResult>,
  axis: 'row' | 'column',
): MaterialTestParameter | null {
  const other = axis === 'row' ? 'column' : 'row';
  return (
    MATERIAL_TEST_PARAMETERS.find(
      (parameter) =>
        differsWithin(cells, parameter, other) && !differsWithin(cells, parameter, axis),
    ) ?? null
  );
}

// True when two cells sharing the same `key` index hold different values.
function differsWithin(
  cells: ReadonlyArray<MaterialTestCellResult>,
  parameter: MaterialTestParameter,
  key: 'row' | 'column',
): boolean {
  const seen = new Map<number, number | undefined>();
  for (const cell of cells) {
    const value = materialTestSettingValue(cell.settings, parameter);
    if (!seen.has(cell[key])) seen.set(cell[key], value);
    else if (seen.get(cell[key]) !== value) return true;
  }
  return false;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}
