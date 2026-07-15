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
  formatCalibrationInterval,
} from './calibration-labels';

const MIN_STEPS = 1;
const MAX_STEPS = 20;
const MIN_SPEED_MM_MIN = 1;
const MIN_POWER_PERCENT = 0;
const MAX_POWER_PERCENT = 100;
const DEFAULT_GAP_MM = 2;
const MIN_SWATCH_SIZE_MM = 1;
const MIN_INTERVAL_MM = 0.05;
const DEFAULT_INTERVAL_MM = 0.1;
const DEFAULT_ORIGIN = { x: 0, y: 0 } as const;

export type IntervalTestGridOptions = {
  readonly steps: number;
  readonly speed: number;
  readonly power: number;
  readonly intervalMinMm: number;
  readonly intervalMaxMm: number;
  readonly swatchSizeMm: number;
  readonly gapMm?: number;
  readonly origin?: {
    readonly x: number;
    readonly y: number;
  };
};

export type IntervalTestCell = {
  readonly step: number;
  readonly objectId: string;
  readonly layerId: string;
  readonly speed: number;
  readonly power: number;
  readonly intervalMm: number;
  readonly bounds: Bounds;
};

export type IntervalTestGrid = {
  readonly scene: Scene;
  readonly cells: ReadonlyArray<IntervalTestCell>;
};

export function generateIntervalTestGrid(options: IntervalTestGridOptions): IntervalTestGrid {
  const steps = clampInteger(options.steps, MIN_STEPS, MAX_STEPS);
  const speed = clampFinite(options.speed, MIN_SPEED_MM_MIN);
  const power = clampPower(options.power);
  const [intervalLow, intervalHigh] = orderedPair(
    clampInterval(options.intervalMinMm),
    clampInterval(options.intervalMaxMm),
  );
  const swatchSize = Math.max(
    MIN_SWATCH_SIZE_MM,
    clampFinite(options.swatchSizeMm, MIN_SWATCH_SIZE_MM),
  );
  const gap = Math.max(0, clampFinite(options.gapMm ?? DEFAULT_GAP_MM, DEFAULT_GAP_MM));
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const intervals = linspace(intervalHigh, intervalLow, steps);
  const labelSize = labelSizeForSwatch(swatchSize);
  const labelGap = Math.max(0.5, Math.min(gap / 2, 2));
  const layers: Layer[] = [];
  const objects: ImportedSvg[] = [];
  const cells: IntervalTestCell[] = [];

  for (let step = 0; step < steps; step += 1) {
    const intervalMm = intervals[step] ?? intervalHigh;
    const layer = intervalLayer({ step, speed, power, intervalMm });
    const x = origin.x + step * (swatchSize + gap);
    const y = origin.y;
    const objectId = `interval-test-cell-${step}`;
    layers.push(layer);
    objects.push(
      squareObject({
        id: objectId,
        operationId: layer.id,
        color: layer.color,
        size: swatchSize,
        x,
        y,
      }),
    );
    cells.push({
      step,
      objectId,
      layerId: layer.id,
      speed,
      power,
      intervalMm,
      bounds: { minX: x, minY: y, maxX: x + swatchSize, maxY: y + swatchSize },
    });
  }

  const labelLayer = createCalibrationLabelLayer('interval-test-labels');
  objects.push(
    ...cells.map((cell) => {
      const label = formatCalibrationInterval(cell.intervalMm);
      return createCalibrationLabelObject({
        id: `interval-test-label-${cell.step}`,
        operationId: labelLayer.id,
        text: label,
        x: cell.bounds.minX + centerOffset(swatchSize, calibrationLabelWidthMm(label, labelSize)),
        y: cell.bounds.maxY + labelGap,
        sizeMm: labelSize,
      });
    }),
  );
  layers.push(labelLayer);

  return { scene: { objects, layers }, cells };
}

function intervalLayer(args: {
  readonly step: number;
  readonly speed: number;
  readonly power: number;
  readonly intervalMm: number;
}): Layer {
  const color = intervalLayerColor(args.step);
  return {
    ...createLayer({
      id: `interval-test-step-${args.step}`,
      name: `Interval ${formatCalibrationInterval(args.intervalMm)} mm`,
      color,
      mode: 'fill',
    }),
    speed: args.speed,
    power: args.power,
    hatchSpacingMm: args.intervalMm,
  };
}

function squareObject(args: {
  readonly id: string;
  readonly operationId: string;
  readonly color: string;
  readonly size: number;
  readonly x: number;
  readonly y: number;
}): ImportedSvg {
  const bounds = { minX: 0, minY: 0, maxX: args.size, maxY: args.size };
  return {
    kind: 'imported-svg',
    id: args.id,
    source: 'interval-test-grid',
    operationIds: [args.operationId],
    bounds,
    transform: { ...IDENTITY_TRANSFORM, x: args.x, y: args.y },
    paths: [{ color: args.color, polylines: [squarePolyline(args.size)] }],
  };
}

function squarePolyline(size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
      { x: 0, y: 0 },
    ],
  };
}

function linspace(start: number, end: number, count: number): number[] {
  if (count === 1) return [start];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => roundMm(start + step * index));
}

function orderedPair(a: number, b: number): readonly [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function intervalLayerColor(step: number): string {
  return `#${(0x200000 + step).toString(16).padStart(6, '0')}`;
}

function labelSizeForSwatch(size: number): number {
  return Math.max(1.4, Math.min(2.5, size * 0.3));
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

function clampInterval(value: number): number {
  return Math.max(MIN_INTERVAL_MM, clampFinite(value, DEFAULT_INTERVAL_MM));
}

function clampFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function roundMm(value: number): number {
  return Number(value.toFixed(6));
}
