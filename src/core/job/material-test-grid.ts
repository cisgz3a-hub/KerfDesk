import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import {
  calibrationLabelWidthMm,
  createCalibrationLabelLayer,
  createCalibrationLabelObject,
  formatCalibrationNumber,
} from './calibration-labels';

const MIN_COUNT = 1;
const MAX_COUNT = 20;
const DEFAULT_GAP_MM = 1;
const DEFAULT_ORIGIN = { x: 0, y: 0 } as const;
const MIN_POWER_PERCENT = 0;
const MAX_POWER_PERCENT = 100;
const MIN_SPEED_MM_MIN = 1;
const MIN_CELL_SIZE_MM = 0.1;

export type MaterialTestGridOptions = {
  readonly rows: number;
  readonly columns: number;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly powerMin: number;
  readonly powerMax: number;
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
  readonly speed: number;
  readonly power: number;
  readonly powerScale: number;
  readonly bounds: Bounds;
};

export type MaterialTestGrid = {
  readonly scene: Scene;
  readonly cells: ReadonlyArray<MaterialTestCell>;
};

type MaterialTestLayout = {
  readonly origin: { readonly x: number; readonly y: number };
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly labelSize: number;
  readonly labelGap: number;
  readonly leftGutter: number;
  readonly topGutter: number;
  readonly speedLabels: ReadonlyArray<string>;
  readonly powerLabels: ReadonlyArray<string>;
};

export function generateMaterialTestGrid(options: MaterialTestGridOptions): MaterialTestGrid {
  const rows = clampInteger(options.rows, MIN_COUNT, MAX_COUNT);
  const columns = clampInteger(options.columns, MIN_COUNT, MAX_COUNT);
  const [speedLow, speedHigh] = orderedPair(
    clampFinite(options.speedMin, MIN_SPEED_MM_MIN),
    clampFinite(options.speedMax, MIN_SPEED_MM_MIN),
  );
  const [powerLow, powerHigh] = orderedPair(
    clampPower(options.powerMin),
    clampPower(options.powerMax),
  );
  const cellWidth = Math.max(MIN_CELL_SIZE_MM, clampFinite(options.cellWidthMm, MIN_CELL_SIZE_MM));
  const cellHeight = Math.max(
    MIN_CELL_SIZE_MM,
    clampFinite(options.cellHeightMm, MIN_CELL_SIZE_MM),
  );
  const gap = Math.max(0, clampFinite(options.gapMm ?? DEFAULT_GAP_MM, DEFAULT_GAP_MM));
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const speeds = linspace(speedHigh, speedLow, rows);
  const powers = linspace(powerLow, powerHigh, columns);
  const layout = materialTestLayout({ origin, cellWidth, cellHeight, gap, speeds, powers });

  const layers: Layer[] = speeds.map((speed, row) => {
    const color = materialTestLayerColor(row);
    return {
      ...createLayer({
        id: `material-test-row-${row}`,
        name: `Material test ${formatCalibrationNumber(speed)} mm/min`,
        color,
        mode: 'fill',
      }),
      power: powerHigh,
      speed,
    };
  });
  const objects: ImportedSvg[] = [];
  const cells: MaterialTestCell[] = [];

  for (let row = 0; row < rows; row += 1) {
    const layer = layers[row];
    if (layer === undefined) continue;
    for (let column = 0; column < columns; column += 1) {
      const power = powers[column] ?? powerLow;
      const powerScale = powerHigh > 0 ? (power / powerHigh) * 100 : 100;
      const x = cellX(layout, column);
      const y = cellY(layout, row);
      const objectId = `material-test-cell-r${row}-c${column}`;
      objects.push(
        squareObject({
          id: objectId,
          operationId: layer.id,
          color: layer.color,
          cellWidth,
          cellHeight,
          x,
          y,
          powerScale,
        }),
      );
      cells.push({
        row,
        column,
        objectId,
        layerId: layer.id,
        speed: layer.speed,
        power,
        powerScale,
        bounds: { minX: x, minY: y, maxX: x + cellWidth, maxY: y + cellHeight },
      });
    }
  }

  const labelLayer = createCalibrationLabelLayer('material-test-labels');
  objects.push(...materialTestLabelObjects(layout, labelLayer.id));
  layers.push(labelLayer);

  return { scene: { objects, layers }, cells };
}

function materialTestLayout(args: {
  readonly origin: { readonly x: number; readonly y: number };
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly speeds: ReadonlyArray<number>;
  readonly powers: ReadonlyArray<number>;
}): MaterialTestLayout {
  const labelSize = labelSizeForCell(args.cellWidth, args.cellHeight);
  const labelGap = Math.max(0.5, Math.min(args.gap, 2));
  const speedLabels = args.speeds.map(formatCalibrationNumber);
  const powerLabels = args.powers.map(formatCalibrationNumber);
  return {
    ...args,
    labelSize,
    labelGap,
    speedLabels,
    powerLabels,
    leftGutter:
      Math.max(...speedLabels.map((label) => calibrationLabelWidthMm(label, labelSize))) + labelGap,
    topGutter: labelSize + labelGap,
  };
}

function materialTestLabelObjects(
  layout: MaterialTestLayout,
  operationId: string,
): ReadonlyArray<ImportedSvg> {
  return [
    ...layout.powerLabels.map((label, column) =>
      createCalibrationLabelObject({
        id: `material-test-power-c${column}`,
        operationId,
        text: label,
        x:
          cellX(layout, column) +
          centerOffset(layout.cellWidth, calibrationLabelWidthMm(label, layout.labelSize)),
        y: layout.origin.y,
        sizeMm: layout.labelSize,
      }),
    ),
    ...layout.speedLabels.map((label, row) =>
      createCalibrationLabelObject({
        id: `material-test-speed-r${row}`,
        operationId,
        text: label,
        x: layout.origin.x,
        y: cellY(layout, row) + centerOffset(layout.cellHeight, layout.labelSize),
        sizeMm: layout.labelSize,
      }),
    ),
  ];
}

function squareObject(args: {
  readonly id: string;
  readonly operationId: string;
  readonly color: string;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly x: number;
  readonly y: number;
  readonly powerScale: number;
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
    powerScale: args.powerScale,
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

function linspace(start: number, end: number, count: number): number[] {
  if (count === 1) return [start];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + step * index);
}

function orderedPair(a: number, b: number): readonly [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function materialTestLayerColor(row: number): string {
  return `#${(0x100000 + row).toString(16).padStart(6, '0')}`;
}

function labelSizeForCell(width: number, height: number): number {
  return Math.max(1.4, Math.min(2.5, width * 0.42, height * 0.45));
}

function cellX(layout: MaterialTestLayout, column: number): number {
  return layout.origin.x + layout.leftGutter + column * (layout.cellWidth + layout.gap);
}

function cellY(layout: MaterialTestLayout, row: number): number {
  return layout.origin.y + layout.topGutter + row * (layout.cellHeight + layout.gap);
}

function centerOffset(span: number, childSpan: number): number {
  return Math.max(0, (span - childSpan) / 2);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}

function clampPower(value: number): number {
  return Math.max(MIN_POWER_PERCENT, Math.min(MAX_POWER_PERCENT, clampFinite(value, 0)));
}

function clampFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
