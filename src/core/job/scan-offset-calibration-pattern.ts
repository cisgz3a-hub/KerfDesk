import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';

const MIN_STEPS = 1;
const MAX_STEPS = 10;
const MIN_SPEED_MM_MIN = 1;
const MIN_POWER_PERCENT = 0;
const MAX_POWER_PERCENT = 100;
const MIN_SWATCH_SIZE_MM = 1;
const MIN_HATCH_SPACING_MM = 0.05;
const DEFAULT_HATCH_SPACING_MM = 0.2;
const DEFAULT_OVERSCAN_MM = 5;
const DEFAULT_GAP_MM = 4;
const DEFAULT_ORIGIN = { x: 0, y: 0 } as const;

export type ScanOffsetCalibrationPatternOptions = {
  readonly steps: number;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly power: number;
  readonly swatchWidthMm: number;
  readonly swatchHeightMm: number;
  readonly hatchSpacingMm?: number;
  readonly overscanMm?: number;
  readonly gapMm?: number;
  readonly origin?: {
    readonly x: number;
    readonly y: number;
  };
};

export type ScanOffsetCalibrationCell = {
  readonly step: number;
  readonly objectId: string;
  readonly layerId: string;
  readonly speed: number;
  readonly power: number;
  readonly bounds: Bounds;
};

export type ScanOffsetCalibrationPattern = {
  readonly scene: Scene;
  readonly cells: ReadonlyArray<ScanOffsetCalibrationCell>;
};

export function generateScanOffsetCalibrationPattern(
  options: ScanOffsetCalibrationPatternOptions,
): ScanOffsetCalibrationPattern {
  const steps = clampInteger(options.steps, MIN_STEPS, MAX_STEPS);
  const [speedLow, speedHigh] = orderedPair(
    clampFinite(options.speedMin, MIN_SPEED_MM_MIN),
    clampFinite(options.speedMax, MIN_SPEED_MM_MIN),
  );
  const power = clampPower(options.power);
  const swatchWidth = Math.max(
    MIN_SWATCH_SIZE_MM,
    clampFinite(options.swatchWidthMm, MIN_SWATCH_SIZE_MM),
  );
  const swatchHeight = Math.max(
    MIN_SWATCH_SIZE_MM,
    clampFinite(options.swatchHeightMm, MIN_SWATCH_SIZE_MM),
  );
  const hatchSpacingMm = Math.max(
    MIN_HATCH_SPACING_MM,
    clampFinite(options.hatchSpacingMm ?? DEFAULT_HATCH_SPACING_MM, DEFAULT_HATCH_SPACING_MM),
  );
  const overscanMm = Math.max(
    0,
    clampFinite(options.overscanMm ?? DEFAULT_OVERSCAN_MM, DEFAULT_OVERSCAN_MM),
  );
  const gapMm = Math.max(0, clampFinite(options.gapMm ?? DEFAULT_GAP_MM, DEFAULT_GAP_MM));
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const speeds = linspace(speedHigh, speedLow, steps);
  const layers: Layer[] = [];
  const objects: ImportedSvg[] = [];
  const cells: ScanOffsetCalibrationCell[] = [];

  for (let step = 0; step < steps; step += 1) {
    const speed = speeds[step] ?? speedHigh;
    const layer = scanOffsetLayer({ step, speed, power, hatchSpacingMm, overscanMm });
    const x = origin.x + step * (swatchWidth + gapMm);
    const y = origin.y;
    const objectId = `scan-offset-calibration-cell-${step}`;
    layers.push(layer);
    objects.push(
      swatchObject({
        id: objectId,
        color: layer.color,
        width: swatchWidth,
        height: swatchHeight,
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
      bounds: { minX: x, minY: y, maxX: x + swatchWidth, maxY: y + swatchHeight },
    });
  }

  return { scene: { objects, layers }, cells };
}

function scanOffsetLayer(args: {
  readonly step: number;
  readonly speed: number;
  readonly power: number;
  readonly hatchSpacingMm: number;
  readonly overscanMm: number;
}): Layer {
  const color = scanOffsetLayerColor(args.step);
  return {
    ...createLayer({ id: `scan-offset-calibration-step-${args.step}`, color, mode: 'fill' }),
    speed: args.speed,
    power: args.power,
    hatchAngleDeg: 0,
    hatchSpacingMm: args.hatchSpacingMm,
    fillStyle: 'scanline',
    fillBidirectional: true,
    fillCrossHatch: false,
    fillOverscanMm: args.overscanMm,
  };
}

function swatchObject(args: {
  readonly id: string;
  readonly color: string;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}): ImportedSvg {
  const bounds = { minX: 0, minY: 0, maxX: args.width, maxY: args.height };
  return {
    kind: 'imported-svg',
    id: args.id,
    source: 'scan-offset-calibration-pattern',
    bounds,
    transform: { ...IDENTITY_TRANSFORM, x: args.x, y: args.y },
    paths: [{ color: args.color, polylines: [rectanglePolyline(args.width, args.height)] }],
  };
}

function rectanglePolyline(width: number, height: number): Polyline {
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
  if (count === 1) return [roundMm(start)];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => roundMm(start + step * index));
}

function orderedPair(a: number, b: number): readonly [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function scanOffsetLayerColor(step: number): string {
  return `#${(0x300000 + step).toString(16).padStart(6, '0')}`;
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

function roundMm(value: number): number {
  return Number(value.toFixed(6));
}
