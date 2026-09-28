import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  LAYER_DEFAULTS,
  type Bounds,
  type ImportedSvg,
  type Layer,
  type ObjectOperationOverride,
  type Polyline,
  type Scene,
} from '../scene';
import { automaticOverscanMm } from './automatic-overscan';
import { createCalibrationLabelLayer, formatCalibrationNumber } from './calibration-labels';
import { MAX_FILL_OVERSCAN_MM } from './compile-job-defaults';
import {
  effectiveCalibrationSpeed,
  fixedMaterialTestValue,
  MATERIAL_TEST_PARAMETERS,
  materialTestAxis,
  materialTestValueLabel,
  type MaterialTestAxis,
  type MaterialTestParameter,
  type MaterialTestParameterInput,
} from './material-test-axes';
import {
  cellX,
  cellY,
  materialTestLabelObjects,
  materialTestLayout,
  type MaterialTestLayout,
} from './material-test-layout';

const MIN_COUNT = 1;
const MAX_COUNT = 20;
const DEFAULT_GAP_MM = 1;
const DEFAULT_ORIGIN = { x: 0, y: 0 } as const;
const MIN_CELL_SIZE_MM = 0.1;

export type MaterialTestGridOptions = MaterialTestParameterInput & {
  readonly rows: number;
  readonly columns: number;
  /** ADR-497: the setting each row varies. Speed when omitted. */
  readonly rowParameter?: MaterialTestParameter;
  /** ADR-497: the setting each column varies. Power when omitted. */
  readonly columnParameter?: MaterialTestParameter;
  /** ADR-497: 'fill' engraves each cell, 'line' cuts its outline. Fill when omitted. */
  readonly mode?: 'fill' | 'line';
  /** Machine acceleration, to size each engraved row's runway for its fastest cell. */
  readonly accelMmPerSec2?: number;
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
  readonly passes: number;
  /** Hatch spacing of an engraved cell; absent for a cut grid. */
  readonly intervalMm?: number;
  readonly bounds: Bounds;
};

export type MaterialTestGrid = {
  readonly scene: Scene;
  readonly cells: ReadonlyArray<MaterialTestCell>;
  readonly rowParameter: MaterialTestParameter;
  readonly columnParameter: MaterialTestParameter;
  readonly mode: 'fill' | 'line';
};

type CellSettings = Readonly<Record<MaterialTestParameter, number>>;

type GridPlan = {
  readonly mode: 'fill' | 'line';
  readonly rowAxis: MaterialTestAxis;
  readonly columnAxis: MaterialTestAxis;
  readonly fixed: CellSettings;
  readonly layers: ReadonlyArray<Layer>;
  readonly layout: MaterialTestLayout;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly maxFeedMmPerMin: number | undefined;
};

export function generateMaterialTestGrid(options: MaterialTestGridOptions): MaterialTestGrid {
  const plan = planMaterialTestGrid(options);
  const objects: ImportedSvg[] = [];
  const cells: MaterialTestCell[] = [];
  plan.rowAxis.values.forEach((_, row) => {
    const layer = plan.layers[row];
    if (layer === undefined) return;
    plan.columnAxis.values.forEach((__, column) => {
      const cell = materialTestCell(plan, layer, row, column);
      objects.push(cell.object);
      cells.push(cell.cell);
    });
  });

  const labelLayer = createCalibrationLabelLayer('material-test-labels');
  objects.push(...materialTestLabelObjects(plan.layout, labelLayer.id));
  return {
    scene: { objects, layers: [...plan.layers, labelLayer] },
    cells,
    rowParameter: plan.rowAxis.parameter,
    columnParameter: plan.columnAxis.parameter,
    mode: plan.mode,
  };
}

function planMaterialTestGrid(options: MaterialTestGridOptions): GridPlan {
  const mode = options.mode === 'line' ? 'line' : 'fill';
  const [rowParameter, columnParameter] = resolveParameters(options, mode);
  const rowAxis = materialTestAxis(
    rowParameter,
    clampInteger(options.rows, MIN_COUNT, MAX_COUNT),
    options,
  );
  const columnAxis = materialTestAxis(
    columnParameter,
    clampInteger(options.columns, MIN_COUNT, MAX_COUNT),
    options,
  );
  const fixed = Object.fromEntries(
    MATERIAL_TEST_PARAMETERS.map((parameter) => [
      parameter,
      fixedMaterialTestValue(parameter, options),
    ]),
  ) as CellSettings;
  const cellWidth = Math.max(MIN_CELL_SIZE_MM, finiteOr(options.cellWidthMm, MIN_CELL_SIZE_MM));
  const cellHeight = Math.max(MIN_CELL_SIZE_MM, finiteOr(options.cellHeightMm, MIN_CELL_SIZE_MM));
  const layers = materialTestLayers({ mode, rowAxis, columnAxis, fixed, options });
  const layout = materialTestLayout({
    origin: options.origin ?? DEFAULT_ORIGIN,
    cellWidth,
    cellHeight,
    gap: Math.max(0, finiteOr(options.gapMm ?? DEFAULT_GAP_MM, DEFAULT_GAP_MM)),
    rowLabels: rowAxis.labels,
    columnLabels: columnAxis.labels,
    runwayMm: Math.max(0, ...layers.map((layer) => (mode === 'fill' ? layer.fillOverscanMm : 0))),
  });
  return {
    mode,
    rowAxis,
    columnAxis,
    fixed,
    layers,
    layout,
    cellWidth,
    cellHeight,
    maxFeedMmPerMin: options.maxFeedMmPerMin,
  };
}

// Two different settings; a cut grid has no hatch spacing to vary.
function resolveParameters(
  options: MaterialTestGridOptions,
  mode: 'fill' | 'line',
): readonly [MaterialTestParameter, MaterialTestParameter] {
  const allowed = MATERIAL_TEST_PARAMETERS.filter(
    (parameter) => mode === 'fill' || parameter !== 'interval',
  );
  const pick = (wanted: MaterialTestParameter | undefined, fallback: MaterialTestParameter) =>
    wanted !== undefined && allowed.includes(wanted) ? wanted : fallback;
  const row = pick(options.rowParameter, 'speed');
  const column = pick(options.columnParameter, row === 'power' ? 'speed' : 'power');
  if (column !== row) return [row, column];
  return [row, allowed.find((parameter) => parameter !== row) ?? 'power'];
}

function materialTestLayers(args: {
  readonly mode: 'fill' | 'line';
  readonly rowAxis: MaterialTestAxis;
  readonly columnAxis: MaterialTestAxis;
  readonly fixed: CellSettings;
  readonly options: MaterialTestGridOptions;
}): Layer[] {
  const { mode, rowAxis, columnAxis, fixed, options } = args;
  return rowAxis.values.map((value, row) => {
    // The row's operation carries its first cell's settings; the other
    // columns override the one setting they vary.
    const settings: CellSettings = {
      ...fixed,
      [columnAxis.parameter]: columnAxis.values[0] ?? fixed[columnAxis.parameter],
      [rowAxis.parameter]: value,
    };
    const effectiveRowValue = rowAxis.effectiveValues[row] ?? value;
    const layer: Layer = {
      ...createLayer({
        id: `material-test-row-${row}`,
        name: materialTestLayerName(rowAxis.parameter, value, effectiveRowValue),
        color: materialTestLayerColor(row),
        mode,
      }),
      // A power column scales each cell from the highest power (powerScale).
      power: columnAxis.parameter === 'power' ? maxOf(columnAxis.values) : settings.power,
      speed: settings.speed,
      passes: settings.passes,
    };
    if (mode === 'line') return layer;
    const fastest =
      columnAxis.parameter === 'speed'
        ? maxOf(columnAxis.effectiveValues)
        : effectiveCalibrationSpeed(settings.speed, options.maxFeedMmPerMin);
    return {
      ...layer,
      hatchSpacingMm: settings.interval,
      fillOverscanMm: materialTestRunwayMm(fastest, options.accelMmPerSec2),
    };
  });
}

// The stored 5 mm, or longer where the row's fastest cell needs more to reach
// speed before it burns (ADR-497). Never shorter than a Fill's default.
export function materialTestRunwayMm(
  fastestFeedMmPerMin: number,
  accelMmPerSec2: number | undefined,
): number {
  if (accelMmPerSec2 === undefined || !Number.isFinite(accelMmPerSec2) || accelMmPerSec2 <= 0) {
    return LAYER_DEFAULTS.fillOverscanMm;
  }
  const needed = automaticOverscanMm({
    feedMmPerMin: effectiveGcodeFeedMmPerMin(fastestFeedMmPerMin),
    accelMmPerSec2,
    scanAngleDeg: 0,
    maxMm: MAX_FILL_OVERSCAN_MM,
  });
  return Math.max(LAYER_DEFAULTS.fillOverscanMm, needed);
}

function materialTestLayerName(
  parameter: MaterialTestParameter,
  value: number,
  effectiveValue: number,
): string {
  switch (parameter) {
    case 'speed':
      return (
        `Material test ${formatCalibrationNumber(value)} requested / ` +
        `${formatCalibrationNumber(effectiveValue)} effective mm/min`
      );
    case 'power':
      return `Material test ${formatCalibrationNumber(value)}% power`;
    case 'passes':
      return `Material test ${value} ${value === 1 ? 'pass' : 'passes'}`;
    case 'interval':
      return `Material test ${materialTestValueLabel('interval', value)} mm hatch spacing`;
  }
}

function materialTestCell(
  plan: GridPlan,
  layer: Layer,
  row: number,
  column: number,
): { readonly object: ImportedSvg; readonly cell: MaterialTestCell } {
  const { columnAxis, layout, cellWidth, cellHeight } = plan;
  const columnValue = columnAxis.values[column] ?? 0;
  const powerColumn = columnAxis.parameter === 'power';
  const powerScale = powerColumn && layer.power > 0 ? (columnValue / layer.power) * 100 : 100;
  const override = powerColumn ? undefined : columnOverride(columnAxis.parameter, columnValue);
  const requestedSpeed = columnAxis.parameter === 'speed' ? columnValue : layer.speed;
  const effectiveSpeed = effectiveCalibrationSpeed(requestedSpeed, plan.maxFeedMmPerMin);
  const x = cellX(layout, column);
  const y = cellY(layout, row);
  const objectId = `material-test-cell-r${row}-c${column}`;
  const object: ImportedSvg = {
    ...squareObject({
      id: objectId,
      operationId: layer.id,
      color: layer.color,
      cellWidth,
      cellHeight,
      x,
      y,
    }),
    ...(powerColumn ? { powerScale } : {}),
    ...(override === undefined ? {} : { operationOverride: override }),
  };
  const intervalMm = columnAxis.parameter === 'interval' ? columnValue : layer.hatchSpacingMm;
  return {
    object,
    cell: {
      row,
      column,
      objectId,
      layerId: layer.id,
      speed: effectiveSpeed,
      requestedSpeed,
      effectiveSpeed,
      power: powerColumn ? columnValue : layer.power,
      powerScale,
      passes: columnAxis.parameter === 'passes' ? columnValue : layer.passes,
      ...(plan.mode === 'fill' ? { intervalMm } : {}),
      bounds: { minX: x, minY: y, maxX: x + cellWidth, maxY: y + cellHeight },
    },
  };
}

function columnOverride(
  parameter: Exclude<MaterialTestParameter, 'power'>,
  value: number,
): ObjectOperationOverride {
  switch (parameter) {
    case 'speed':
      return { speed: value };
    case 'passes':
      return { passes: value };
    case 'interval':
      return { hatchSpacingMm: value };
  }
}

function squareObject(args: {
  readonly id: string;
  readonly operationId: string;
  readonly color: string;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly x: number;
  readonly y: number;
}): ImportedSvg {
  const bounds = { minX: 0, minY: 0, maxX: args.cellWidth, maxY: args.cellHeight };
  return {
    kind: 'imported-svg',
    id: args.id,
    source: 'material-test-grid',
    operationIds: [args.operationId],
    bounds,
    transform: { ...IDENTITY_TRANSFORM, x: args.x, y: args.y },
    paths: [{ color: args.color, polylines: [squarePolyline(args.cellWidth, args.cellHeight)] }],
  };
}

function squarePolyline(width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
    ],
  };
}

function materialTestLayerColor(row: number): string {
  return `#${(0x100000 + row).toString(16).padStart(6, '0')}`;
}

function maxOf(values: ReadonlyArray<number>): number {
  return values.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
