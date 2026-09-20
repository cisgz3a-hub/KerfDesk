// Columnar storage for a route's steps.
//
// A scanline fill over a dense trace compiles to millions of steps, and as
// plain objects each one costs about 217 bytes measured live: the step record,
// its nested points, and a polyline array for every two-point span. The same
// route in the typed arrays below costs a fraction of that, and crosses a
// worker boundary as transferable buffers rather than a structured clone of
// several million objects.
//
// The layout is the one the imported-G-code transfer has used since ADR-254;
// packed-gcode-result.ts is a thin wrapper over this module so both paths
// share one codec and one set of round-trip tests.
//
// Not every step is representable: per-vertex Z (`zs`) and the multi-tool
// `toolId` have no column, so routes that carry them stay plain arrays.
// canPackToolpathStep is the gate, and packToolpath checks it before
// allocating anything — a packed route never silently loses a field.

import type { ToolpathStepList } from './toolpath-steps';
import type { RasterToolpathSource, ToolpathStep } from './toolpath-types';

const STEP_TRAVEL = 0;
const STEP_CUT = 1;
const STEP_PLUNGE = 2;
const STEP_VALUE_WIDTH = 8;
const RASTER_VALUE_WIDTH = 7;
const POINT_WIDTH = 2;
const FLAG_MOTION = 1;
const FLAG_FEED = 2;
const FLAG_Z = 4;
const FLAG_RASTER = 8;
const FLAG_GROUP = 16;
const FLAG_PASS = 32;
const MISSING_STRING = -1;

export type PackedToolpath = {
  readonly strings: ReadonlyArray<string>;
  readonly stepKinds: Uint8Array;
  readonly stepFlags: Uint8Array;
  readonly stepValues: Float64Array;
  readonly polylineOffsets: Uint32Array;
  readonly polylinePoints: Float64Array;
  readonly rasterValues: Float64Array;
};

/** False for a step whose fields have no column; its route stays a plain array. */
export function canPackToolpathStep(step: ToolpathStep): boolean {
  if (step.kind === 'travel') return true;
  if (step.kind === 'plunge') return step.toolId === undefined;
  return step.zs === undefined && step.toolId === undefined;
}

/** Buffer sizes for a route, measured before anything is allocated. */
export type PackedToolpathPlan = {
  readonly stepCount: number;
  readonly pointCount: number;
  readonly hasRasterSource: boolean;
};

/** Measure a route, or null when a step carries a field this layout has no column for. */
export function planPackedToolpath(steps: ToolpathStepList): PackedToolpathPlan | null {
  let pointCount = 0;
  let hasRasterSource = false;
  for (const step of steps) {
    if (!canPackToolpathStep(step)) return null;
    if (step.kind !== 'cut') continue;
    pointCount += step.polyline.length;
    hasRasterSource ||= step.source !== undefined;
  }
  return { stepCount: steps.length, pointCount, hasRasterSource };
}

/** Pack a route, or null when a step carries a field this layout has no column for. */
export function packToolpath(steps: ToolpathStepList): PackedToolpath | null {
  const plan = planPackedToolpath(steps);
  if (plan === null) return null;
  return packToolpathUnchecked(steps, plan.pointCount, plan.hasRasterSource);
}

/**
 * Pack a measured route one step at a time. `stepAt` is called once per index,
 * in order, and its result is consumed immediately — a caller that derives
 * each step from a source it owns can release that source as it goes, so the
 * mapped route never exists as a second complete array of objects.
 */
export function packToolpathFrom(
  plan: PackedToolpathPlan,
  stepAt: (index: number) => ToolpathStep,
): PackedToolpath {
  const { strings, stringIndex } = stringPool();
  const packed = allocatePackedToolpath(plan, strings);
  let pointIndex = 0;
  for (let index = 0; index < plan.stepCount; index += 1) {
    packed.polylineOffsets[index] = pointIndex;
    pointIndex = packStep(packed, index, pointIndex, stepAt(index), stringIndex);
  }
  packed.polylineOffsets[plan.stepCount] = pointIndex;
  return packed;
}

/**
 * Pack without the representability gate, dropping any field with no column.
 * Only for callers whose steps are known to be plain — the G-code importer's
 * parsed program, whose bytes this preserves exactly.
 */
export function packToolpathUnchecked(
  steps: ToolpathStepList,
  pointCount: number,
  hasRasterSource: boolean,
): PackedToolpath {
  const { strings, stringIndex } = stringPool();
  const packed = allocatePackedToolpath(
    { stepCount: steps.length, pointCount, hasRasterSource },
    strings,
  );
  let pointIndex = 0;
  for (const [stepIndex, step] of steps.entries()) {
    packed.polylineOffsets[stepIndex] = pointIndex;
    pointIndex = packStep(packed, stepIndex, pointIndex, step, stringIndex);
  }
  packed.polylineOffsets[steps.length] = pointIndex;
  return packed;
}

function stringPool(): {
  readonly strings: string[];
  readonly stringIndex: (value: string | undefined) => number;
} {
  const strings: string[] = [];
  const indices = new Map<string, number>();
  return {
    strings,
    stringIndex: (value) => {
      if (value === undefined) return MISSING_STRING;
      const existing = indices.get(value);
      if (existing !== undefined) return existing;
      const index = strings.length;
      strings.push(value);
      indices.set(value, index);
      return index;
    },
  };
}

function allocatePackedToolpath(plan: PackedToolpathPlan, strings: string[]): PackedToolpath {
  const packed: PackedToolpath = {
    strings,
    stepKinds: new Uint8Array(plan.stepCount),
    stepFlags: new Uint8Array(plan.stepCount),
    stepValues: new Float64Array(plan.stepCount * STEP_VALUE_WIDTH),
    polylineOffsets: new Uint32Array(plan.stepCount + 1),
    polylinePoints: new Float64Array(plan.pointCount * POINT_WIDTH),
    rasterValues: new Float64Array(plan.hasRasterSource ? plan.stepCount * RASTER_VALUE_WIDTH : 0),
  };
  packed.rasterValues.fill(MISSING_STRING);
  return packed;
}

export function packedToolpathTransferables(packed: PackedToolpath): ReadonlyArray<ArrayBuffer> {
  return [
    transferableBuffer(packed.stepKinds),
    transferableBuffer(packed.stepFlags),
    transferableBuffer(packed.stepValues),
    transferableBuffer(packed.polylineOffsets),
    transferableBuffer(packed.polylinePoints),
    transferableBuffer(packed.rasterValues),
  ];
}

function packStep(
  packed: PackedToolpath,
  index: number,
  pointIndex: number,
  step: ToolpathStep,
  stringIndex: (value: string | undefined) => number,
): number {
  if (step.kind === 'travel') {
    packTravelStep(packed, index, step);
    return pointIndex;
  }
  if (step.kind === 'plunge') {
    packPlungeStep(packed, index, step);
    return pointIndex;
  }
  return packCutStep(packed, index, pointIndex, step, stringIndex);
}

function packTravelStep(
  packed: PackedToolpath,
  index: number,
  step: Extract<ToolpathStep, { kind: 'travel' }>,
): void {
  packed.stepKinds[index] = STEP_TRAVEL;
  packed.stepFlags[index] =
    (step.motion === undefined ? 0 : FLAG_MOTION) |
    (step.motion === 'feed' ? FLAG_FEED : 0) |
    (step.z === undefined ? 0 : FLAG_Z);
  packed.stepValues.set(
    [
      step.from.x,
      step.from.y,
      step.to.x,
      step.to.y,
      step.length,
      step.z?.from ?? 0,
      step.z?.to ?? 0,
    ],
    index * STEP_VALUE_WIDTH,
  );
}

function packPlungeStep(
  packed: PackedToolpath,
  index: number,
  step: Extract<ToolpathStep, { kind: 'plunge' }>,
): void {
  packed.stepKinds[index] = STEP_PLUNGE;
  packed.stepValues.set(
    [step.at.x, step.at.y, step.fromZ, step.toZ, step.length],
    index * STEP_VALUE_WIDTH,
  );
}

function packCutStep(
  packed: PackedToolpath,
  index: number,
  pointIndex: number,
  step: Extract<ToolpathStep, { kind: 'cut' }>,
  stringIndex: (value: string | undefined) => number,
): number {
  packed.stepKinds[index] = STEP_CUT;
  packed.stepFlags[index] =
    (step.z === undefined ? 0 : FLAG_Z) |
    (step.source === undefined ? 0 : FLAG_RASTER) |
    (step.groupId === undefined ? 0 : FLAG_GROUP) |
    (step.passIndex === undefined ? 0 : FLAG_PASS);
  packed.stepValues.set(
    [
      step.length,
      step.z?.from ?? 0,
      step.z?.to ?? 0,
      step.passIndex ?? 0,
      stringIndex(step.color),
      stringIndex(step.groupId),
    ],
    index * STEP_VALUE_WIDTH,
  );
  if (step.source !== undefined) {
    packed.rasterValues.set(
      [
        step.source.passIndex,
        step.source.rowIndex,
        step.source.spanIndex,
        step.source.pixelStartX,
        step.source.pixelEndX,
        stringIndex(step.source.objectId),
        stringIndex(step.source.source),
      ],
      index * RASTER_VALUE_WIDTH,
    );
  }
  for (const point of step.polyline) {
    packed.polylinePoints[pointIndex * POINT_WIDTH] = point.x;
    packed.polylinePoints[pointIndex * POINT_WIDTH + 1] = point.y;
    pointIndex += 1;
  }
  return pointIndex;
}

/**
 * The step's own length, read straight out of the value column.
 *
 * The scrubber sums every length in the route to place the head, and building
 * a step object per index to read one number made that walk an order of
 * magnitude slower on a multi-million-step route. Every kind stores its length
 * at a fixed offset, so no step has to be materialized for it.
 */
export function packedStepLength(packed: PackedToolpath, index: number): number {
  const kind = packed.stepKinds[index];
  if (kind === undefined) return 0;
  const offset = index * STEP_VALUE_WIDTH + (kind === STEP_CUT ? 0 : 4);
  return packed.stepValues[offset] ?? 0;
}

export function unpackToolpathStep(packed: PackedToolpath, index: number): ToolpathStep {
  const kind = valueAt(packed.stepKinds, index, 'step kind');
  const flags = valueAt(packed.stepFlags, index, 'step flags');
  const base = index * STEP_VALUE_WIDTH;
  const value = (offset: number): number => valueAt(packed.stepValues, base + offset, 'step');
  if (kind === STEP_TRAVEL) {
    return {
      kind: 'travel',
      from: { x: value(0), y: value(1) },
      to: { x: value(2), y: value(3) },
      length: value(4),
      ...(hasFlag(flags, FLAG_MOTION)
        ? { motion: hasFlag(flags, FLAG_FEED) ? ('feed' as const) : ('rapid' as const) }
        : {}),
      ...(hasFlag(flags, FLAG_Z) ? { z: { from: value(5), to: value(6) } } : {}),
    };
  }
  if (kind === STEP_PLUNGE) {
    return {
      kind: 'plunge',
      at: { x: value(0), y: value(1) },
      fromZ: value(2),
      toZ: value(3),
      length: value(4),
    };
  }
  if (kind !== STEP_CUT) throw new Error(`Unknown packed toolpath step kind ${kind}.`);
  const pointStart = valueAt(packed.polylineOffsets, index, 'point start');
  const pointEnd = valueAt(packed.polylineOffsets, index + 1, 'point end');
  const polyline = Array.from({ length: pointEnd - pointStart }, (_, offset) => {
    const pointIndex = pointStart + offset;
    return {
      x: valueAt(packed.polylinePoints, pointIndex * POINT_WIDTH, 'point x'),
      y: valueAt(packed.polylinePoints, pointIndex * POINT_WIDTH + 1, 'point y'),
    };
  });
  return {
    kind: 'cut',
    color: stringAt(packed.strings, value(4)),
    polyline,
    length: value(0),
    ...(hasFlag(flags, FLAG_Z) ? { z: { from: value(1), to: value(2) } } : {}),
    ...(hasFlag(flags, FLAG_GROUP) ? { groupId: stringAt(packed.strings, value(5)) } : {}),
    ...(hasFlag(flags, FLAG_PASS) ? { passIndex: value(3) } : {}),
    ...(hasFlag(flags, FLAG_RASTER) ? { source: unpackRasterSource(packed, index) } : {}),
  };
}

function unpackRasterSource(packed: PackedToolpath, index: number): RasterToolpathSource {
  const base = index * RASTER_VALUE_WIDTH;
  const value = (offset: number): number => valueAt(packed.rasterValues, base + offset, 'raster');
  const objectId = optionalStringAt(packed.strings, value(5));
  const source = optionalStringAt(packed.strings, value(6));
  return {
    kind: 'raster',
    passIndex: value(0),
    rowIndex: value(1),
    spanIndex: value(2),
    pixelStartX: value(3),
    pixelEndX: value(4),
    ...(objectId === undefined ? {} : { objectId }),
    ...(source === undefined ? {} : { source }),
  };
}

function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}

function stringAt(strings: ReadonlyArray<string>, index: number): string {
  const value = strings[index];
  if (value === undefined) throw new Error(`Packed toolpath string is missing at ${index}.`);
  return value;
}

function optionalStringAt(strings: ReadonlyArray<string>, index: number): string | undefined {
  return index === MISSING_STRING ? undefined : stringAt(strings, index);
}

function valueAt(target: ArrayLike<number>, index: number, field: string): number {
  const value = target[index];
  if (value === undefined) throw new Error(`Packed toolpath ${field} is missing at ${index}.`);
  return value;
}

function transferableBuffer(view: ArrayBufferView): ArrayBuffer {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new Error('A packed toolpath unexpectedly uses a shared buffer.');
  }
  return view.buffer;
}
