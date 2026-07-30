import type { ToolpathStep } from '../../core/job';
import type { ParseGcodeProgramResult } from '../../io/gcode';

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

type PackedGcodeOk = {
  readonly kind: 'ok';
  readonly totalLength: number;
  readonly summary: Extract<ParseGcodeProgramResult, { kind: 'ok' }>['summary'];
  readonly notes: ReadonlyArray<string>;
  readonly strings: ReadonlyArray<string>;
  readonly stepKinds: Uint8Array;
  readonly stepFlags: Uint8Array;
  readonly stepValues: Float64Array;
  readonly polylineOffsets: Uint32Array;
  readonly polylinePoints: Float64Array;
  readonly rasterValues: Float64Array;
};

export type PackedGcodeResult = { readonly kind: 'error'; readonly reason: string } | PackedGcodeOk;

export function packGcodeResult(result: ParseGcodeProgramResult): PackedGcodeResult {
  if (result.kind === 'error') return result;
  const pointCount = result.toolpath.steps.reduce(
    (sum, step) => sum + (step.kind === 'cut' ? step.polyline.length : 0),
    0,
  );
  const hasRasterSource = result.toolpath.steps.some(
    (step) => step.kind === 'cut' && step.source !== undefined,
  );
  const strings: string[] = [];
  const stringIndices = new Map<string, number>();
  const stringIndex = (value: string | undefined): number => {
    if (value === undefined) return MISSING_STRING;
    const existing = stringIndices.get(value);
    if (existing !== undefined) return existing;
    const index = strings.length;
    strings.push(value);
    stringIndices.set(value, index);
    return index;
  };
  const packed: PackedGcodeOk = {
    kind: 'ok',
    totalLength: result.toolpath.totalLength,
    summary: result.summary,
    notes: result.notes,
    strings,
    stepKinds: new Uint8Array(result.toolpath.steps.length),
    stepFlags: new Uint8Array(result.toolpath.steps.length),
    stepValues: new Float64Array(result.toolpath.steps.length * STEP_VALUE_WIDTH),
    polylineOffsets: new Uint32Array(result.toolpath.steps.length + 1),
    polylinePoints: new Float64Array(pointCount * POINT_WIDTH),
    rasterValues: new Float64Array(
      hasRasterSource ? result.toolpath.steps.length * RASTER_VALUE_WIDTH : 0,
    ),
  };
  packed.rasterValues.fill(MISSING_STRING);
  let pointIndex = 0;
  for (const [stepIndex, step] of result.toolpath.steps.entries()) {
    packed.polylineOffsets[stepIndex] = pointIndex;
    pointIndex = packStep(packed, stepIndex, pointIndex, step, stringIndex);
  }
  packed.polylineOffsets[result.toolpath.steps.length] = pointIndex;
  return packed;
}

export function unpackGcodeResult(result: PackedGcodeResult): ParseGcodeProgramResult {
  if (result.kind === 'error') return result;
  const steps = Array.from({ length: result.stepKinds.length }, (_, index) =>
    unpackStep(result, index),
  );
  return {
    kind: 'ok',
    toolpath: { steps, totalLength: result.totalLength },
    summary: result.summary,
    notes: result.notes,
  };
}

export function packedGcodeTransferables(result: PackedGcodeResult): ReadonlyArray<ArrayBuffer> {
  if (result.kind === 'error') return [];
  return [
    transferableBuffer(result.stepKinds),
    transferableBuffer(result.stepFlags),
    transferableBuffer(result.stepValues),
    transferableBuffer(result.polylineOffsets),
    transferableBuffer(result.polylinePoints),
    transferableBuffer(result.rasterValues),
  ];
}

function packStep(
  packed: PackedGcodeOk,
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
  packed: PackedGcodeOk,
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
  packed: PackedGcodeOk,
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
  packed: PackedGcodeOk,
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
    const rasterBase = index * RASTER_VALUE_WIDTH;
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
      rasterBase,
    );
  }
  for (const point of step.polyline) {
    packed.polylinePoints[pointIndex * POINT_WIDTH] = point.x;
    packed.polylinePoints[pointIndex * POINT_WIDTH + 1] = point.y;
    pointIndex += 1;
  }
  return pointIndex;
}

function unpackStep(packed: PackedGcodeOk, index: number): ToolpathStep {
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
  if (kind !== STEP_CUT) throw new Error(`Unknown packed G-code step kind ${kind}.`);
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

function unpackRasterSource(
  packed: PackedGcodeOk,
  index: number,
): NonNullable<Extract<ToolpathStep, { kind: 'cut' }>['source']> {
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
  if (value === undefined) throw new Error(`Packed G-code string is missing at ${index}.`);
  return value;
}

function optionalStringAt(strings: ReadonlyArray<string>, index: number): string | undefined {
  return index === MISSING_STRING ? undefined : stringAt(strings, index);
}

function valueAt(target: ArrayLike<number>, index: number, field: string): number {
  const value = target[index];
  if (value === undefined) throw new Error(`Packed G-code ${field} is missing at ${index}.`);
  return value;
}

function transferableBuffer(view: ArrayBufferView): ArrayBuffer {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new Error('Packed G-code unexpectedly uses a shared buffer.');
  }
  return view.buffer;
}
