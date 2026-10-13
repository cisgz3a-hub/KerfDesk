/** A position around the frame perimeter, in its traversal order. */
export type FrameStartPoint = {
  readonly edge: 0 | 1 | 2 | 3;
  readonly fraction: number;
};

/** Scene millimetres, or a relative preference inside the output bounds. */
export type JobStartPoint = {
  readonly x: number;
  readonly y: number;
  readonly relative?: true;
};

export type ProjectStartPoints = {
  readonly frame?: FrameStartPoint;
  readonly job?: JobStartPoint;
};

/** Optional malformed selections fall back independently to automatic. */
export function normalizeProjectStartPoints(value: unknown): ProjectStartPoints | undefined {
  if (!isRecord(value)) return undefined;
  const frame = normalizeFrame(value['frame']);
  const job = normalizeJob(value['job']);
  if (frame === undefined && job === undefined) return undefined;
  return { ...(frame === undefined ? {} : { frame }), ...(job === undefined ? {} : { job }) };
}

function normalizeFrame(value: unknown): FrameStartPoint | undefined {
  if (!isRecord(value)) return undefined;
  const edge = value['edge'];
  const fraction = value['fraction'];
  if (edge !== 0 && edge !== 1 && edge !== 2 && edge !== 3) return undefined;
  if (!unitInterval(fraction)) return undefined;
  return { edge, fraction };
}

function normalizeJob(value: unknown): JobStartPoint | undefined {
  if (!isRecord(value)) return undefined;
  const x = value['x'];
  const y = value['y'];
  if (!finite(x) || !finite(y)) return undefined;
  if (value['relative'] !== undefined && value['relative'] !== true) return undefined;
  if (value['relative'] === true) {
    return unitInterval(x) && unitInterval(y) ? { x, y, relative: true } : undefined;
  }
  return { x, y };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function unitInterval(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}
