import type { JogAxisSigns } from '../../core/devices';
import type { Vec2 } from '../../core/scene';

export const DEFAULT_JOG_FEED_MM_PER_MIN = 3000;

const JOG_FEED_PRESETS_MM_PER_MIN = [100, 500, 1000, 3000, 6000, 12000] as const;

export type PhysicalJogDirection = {
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
};

export type JogVector = {
  readonly dx?: number;
  readonly dy?: number;
  readonly feed: number;
};

export function defaultJogFeed(maxFeed: number): number {
  return clampJogFeed(DEFAULT_JOG_FEED_MM_PER_MIN, maxFeed);
}

export function clampJogFeed(requested: number, maxFeed: number): number {
  const safeMax = Number.isFinite(maxFeed) && maxFeed > 0 ? maxFeed : 1;
  return Math.max(1, Math.min(safeMax, Math.round(requested)));
}

export function jogFeedOptions(maxFeed: number): ReadonlyArray<number> {
  const safeMax = Number.isFinite(maxFeed) && maxFeed > 0 ? Math.round(maxFeed) : 1;
  return [
    ...new Set([...JOG_FEED_PRESETS_MM_PER_MIN.filter((feed) => feed <= safeMax), safeMax]),
  ].sort((a, b) => a - b);
}

export function stepJogVector(
  direction: PhysicalJogDirection,
  stepMm: number,
  signs: JogAxisSigns,
  feed: number,
): JogVector {
  return vectorForDistances(direction, stepMm, stepMm, signs, feed);
}

export function continuousJogVector(
  direction: PhysicalJogDirection,
  position: Vec2 | null,
  bed: { readonly width: number; readonly height: number },
  signs: JogAxisSigns,
  feed: number,
): JogVector | null {
  const machineXDirection = direction.x * signs.x;
  const machineYDirection = direction.y * signs.y;
  const xDistance = distanceToLimit(position?.x, bed.width, machineXDirection);
  const yDistance = distanceToLimit(position?.y, bed.height, machineYDirection);
  const vector = vectorForDistances(direction, xDistance, yDistance, signs, feed);
  return vector.dx === undefined && vector.dy === undefined ? null : vector;
}

export function jogVectorLabel(vector: JogVector, stepMm: number): string {
  const parts: string[] = [];
  if (vector.dx !== undefined) parts.push(`${signedAxis('X', vector.dx)}`);
  if (vector.dy !== undefined) parts.push(`${signedAxis('Y', vector.dy)}`);
  return `Jog ${parts.join(' ')} ${stepMm} mm`;
}

function vectorForDistances(
  direction: PhysicalJogDirection,
  xDistance: number,
  yDistance: number,
  signs: JogAxisSigns,
  feed: number,
): JogVector {
  const dx = direction.x === 0 ? 0 : direction.x * signs.x * xDistance;
  const dy = direction.y === 0 ? 0 : direction.y * signs.y * yDistance;
  return {
    ...(Math.abs(dx) > 1e-3 ? { dx } : {}),
    ...(Math.abs(dy) > 1e-3 ? { dy } : {}),
    feed,
  };
}

function distanceToLimit(
  coordinate: number | undefined,
  extent: number,
  direction: number,
): number {
  if (direction === 0) return 0;
  const safeExtent = Number.isFinite(extent) && extent > 0 ? extent : 1;
  if (coordinate === undefined || !Number.isFinite(coordinate)) return safeExtent;
  return direction > 0 ? Math.max(0, safeExtent - coordinate) : Math.max(0, coordinate);
}

function signedAxis(axis: 'X' | 'Y', value: number): string {
  return `${value >= 0 ? '+' : '-'}${axis}`;
}
