// How accurate a saved camera model measured on the bed (ADR-440, ADR-441
// Amendment 1): the summary figures, plus each engraved ring's own error and
// the area the target covered, so the workspace can show where on the bed the
// camera is trusted and a later photo of the same target can be checked
// against it. Pure core.

export type BedArea = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SavedMarkError = {
  /** Where the ring was engraved, bed mm. */
  readonly x: number;
  readonly y: number;
  /** Where the model puts the photographed ring, minus where it was engraved, mm. */
  readonly dxMm: number;
  readonly dyMm: number;
  /** Left out of the fit as a mis-detection. */
  readonly rejected?: true;
};

export type CameraModelAccuracy = {
  /** Root-mean-square distance between each engraved ring and where the model puts it, mm. */
  readonly rmsErrorMm: number;
  readonly maxErrorMm: number;
  readonly foundMarks: number;
  readonly expectedMarks: number;
  /** Surface height of the engraved target the fit was measured at, mm. */
  readonly targetHeightMm: number;
  /** The engraved target's rings, bed mm; absent on records saved without them. */
  readonly targetArea?: BedArea;
  readonly marks?: ReadonlyArray<SavedMarkError>;
};

// A full-bed target has on the order of a hundred rings; anything far beyond
// that is not a record this app wrote.
const MAX_SAVED_MARKS = 4000;
// Saved to the micrometre: far below what a camera resolves.
const SAVED_DECIMALS = 1e3;

export function savedMarkErrors(
  marks: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly dxMm: number;
    readonly dyMm: number;
    readonly rejected: boolean;
  }>,
): SavedMarkError[] {
  const saved: SavedMarkError[] = [];
  for (const mark of marks) {
    // A ring the model cannot see (NaN) has no error to show.
    if (!Number.isFinite(mark.dxMm) || !Number.isFinite(mark.dyMm)) continue;
    saved.push({
      x: rounded(mark.x),
      y: rounded(mark.y),
      dxMm: rounded(mark.dxMm),
      dyMm: rounded(mark.dyMm),
      ...(mark.rejected ? { rejected: true as const } : {}),
    });
  }
  return saved;
}

export function normalizeCameraModelAccuracy(value: unknown): CameraModelAccuracy | undefined {
  if (!isRecord(value)) return undefined;
  const rmsErrorMm = nonNegative(value['rmsErrorMm']);
  const maxErrorMm = nonNegative(value['maxErrorMm']);
  const foundMarks = nonNegative(value['foundMarks']);
  const expectedMarks = nonNegative(value['expectedMarks']);
  const targetHeightMm = nonNegative(value['targetHeightMm']);
  if (
    rmsErrorMm === undefined ||
    maxErrorMm === undefined ||
    foundMarks === undefined ||
    expectedMarks === undefined ||
    targetHeightMm === undefined
  ) {
    return undefined;
  }
  const targetArea = optional(value['targetArea'], normalizeArea);
  const marks = optional(value['marks'], normalizeMarks);
  if (targetArea === null || marks === null) return undefined;
  return {
    rmsErrorMm,
    maxErrorMm,
    foundMarks,
    expectedMarks,
    targetHeightMm,
    ...(targetArea === undefined ? {} : { targetArea }),
    ...(marks === undefined ? {} : { marks }),
  };
}

// Absent stays absent; present but malformed is null, which drops the record.
function optional<T>(
  value: unknown,
  normalize: (v: unknown) => T | undefined,
): T | undefined | null {
  if (value === undefined) return undefined;
  return normalize(value) ?? null;
}

function normalizeArea(value: unknown): BedArea | undefined {
  if (!isRecord(value)) return undefined;
  const x = finite(value['x']);
  const y = finite(value['y']);
  const width = finite(value['width']);
  const height = finite(value['height']);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

function normalizeMarks(value: unknown): SavedMarkError[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SAVED_MARKS) return undefined;
  const marks: SavedMarkError[] = [];
  for (const item of value) {
    const mark = normalizeMark(item);
    if (mark === undefined) return undefined;
    marks.push(mark);
  }
  return marks;
}

function normalizeMark(value: unknown): SavedMarkError | undefined {
  if (!isRecord(value)) return undefined;
  const x = finite(value['x']);
  const y = finite(value['y']);
  const dxMm = finite(value['dxMm']);
  const dyMm = finite(value['dyMm']);
  const rejected = value['rejected'];
  if (x === undefined || y === undefined || dxMm === undefined || dyMm === undefined) {
    return undefined;
  }
  if (rejected !== undefined && rejected !== true) return undefined;
  return { x, y, dxMm, dyMm, ...(rejected === true ? { rejected } : {}) };
}

function rounded(value: number): number {
  return Math.round(value * SAVED_DECIMALS) / SAVED_DECIMALS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegative(value: unknown): number | undefined {
  const n = finite(value);
  return n !== undefined && n >= 0 ? n : undefined;
}
