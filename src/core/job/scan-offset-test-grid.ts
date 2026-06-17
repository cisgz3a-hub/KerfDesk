import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';

const DEFAULT_SPEEDS_MM_MIN = [600, 1200, 1800] as const;
const DEFAULT_WIDTH_MM = 50;
const DEFAULT_HEIGHT_MM = 10;
const DEFAULT_GAP_MM = 5;
const DEFAULT_INTERVAL_MM = 0.2;
const DEFAULT_OVERSCAN_MM = 3;
const MIN_SPEED_MM_MIN = 1;
const MIN_SIZE_MM = 1;
const MIN_INTERVAL_MM = 0.05;
const MIN_POWER_PERCENT = 0;
const MAX_POWER_PERCENT = 100;
const DEFAULT_ORIGIN = { x: 0, y: 0 } as const;

export type ScanOffsetTestGridOptions = {
  readonly speeds: ReadonlyArray<number>;
  readonly power: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly lineIntervalMm?: number;
  readonly gapMm?: number;
  readonly origin?: {
    readonly x: number;
    readonly y: number;
  };
};

export type ScanOffsetTestCell = {
  readonly index: number;
  readonly objectId: string;
  readonly layerId: string;
  readonly speed: number;
  readonly power: number;
  readonly lineIntervalMm: number;
  readonly bounds: Bounds;
};

export type ScanOffsetTestGrid = {
  readonly scene: Scene;
  readonly cells: ReadonlyArray<ScanOffsetTestCell>;
};

export function generateScanOffsetTestGrid(options: ScanOffsetTestGridOptions): ScanOffsetTestGrid {
  const speeds = normalizedSpeeds(options.speeds);
  const power = clampPower(options.power);
  const width = Math.max(
    MIN_SIZE_MM,
    clampFinite(options.widthMm ?? DEFAULT_WIDTH_MM, DEFAULT_WIDTH_MM),
  );
  const height = Math.max(
    MIN_SIZE_MM,
    clampFinite(options.heightMm ?? DEFAULT_HEIGHT_MM, DEFAULT_HEIGHT_MM),
  );
  const lineIntervalMm = Math.max(
    MIN_INTERVAL_MM,
    clampFinite(options.lineIntervalMm ?? DEFAULT_INTERVAL_MM, DEFAULT_INTERVAL_MM),
  );
  const gap = Math.max(0, clampFinite(options.gapMm ?? DEFAULT_GAP_MM, DEFAULT_GAP_MM));
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const layers: Layer[] = [];
  const objects: ImportedSvg[] = [];
  const cells: ScanOffsetTestCell[] = [];

  for (let index = 0; index < speeds.length; index += 1) {
    const speed = speeds[index] ?? DEFAULT_SPEEDS_MM_MIN[0];
    const layer = scanOffsetLayer({ index, speed, power, lineIntervalMm });
    const x = origin.x;
    const y = origin.y + index * (height + gap);
    const objectId = `scan-offset-test-cell-${index}`;
    layers.push(layer);
    objects.push(rectObject({ id: objectId, color: layer.color, width, height, x, y }));
    cells.push({
      index,
      objectId,
      layerId: layer.id,
      speed,
      power,
      lineIntervalMm,
      bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
    });
  }

  return { scene: { objects, layers }, cells };
}

function scanOffsetLayer(args: {
  readonly index: number;
  readonly speed: number;
  readonly power: number;
  readonly lineIntervalMm: number;
}): Layer {
  return {
    ...createLayer({
      id: `scan-offset-test-speed-${args.index}`,
      color: scanOffsetLayerColor(args.index),
      mode: 'fill',
    }),
    power: args.power,
    speed: args.speed,
    hatchAngleDeg: 0,
    hatchSpacingMm: args.lineIntervalMm,
    fillOverscanMm: DEFAULT_OVERSCAN_MM,
    fillStyle: 'scanline',
    fillBidirectional: true,
    fillCrossHatch: false,
  };
}

function rectObject(args: {
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
    source: 'scan-offset-test-grid',
    bounds,
    transform: { ...IDENTITY_TRANSFORM, x: args.x, y: args.y },
    paths: [{ color: args.color, polylines: [rectPolyline(args.width, args.height)] }],
  };
}

function rectPolyline(width: number, height: number): Polyline {
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

function normalizedSpeeds(speeds: ReadonlyArray<number>): ReadonlyArray<number> {
  const valid = speeds
    .filter((speed) => Number.isFinite(speed) && speed >= MIN_SPEED_MM_MIN)
    .map((speed) => Number(speed.toFixed(6)));
  return valid.length > 0 ? valid : DEFAULT_SPEEDS_MM_MIN;
}

function scanOffsetLayerColor(index: number): string {
  return `#${(0x300000 + index).toString(16).padStart(6, '0')}`;
}

function clampPower(value: number): number {
  return Math.max(MIN_POWER_PERCENT, Math.min(MAX_POWER_PERCENT, clampFinite(value, 0)));
}

function clampFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
