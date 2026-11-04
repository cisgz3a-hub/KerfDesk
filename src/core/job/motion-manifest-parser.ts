import { isSendableGcodeLine } from '../controllers/grbl';
import { applySharedGCode, resolveAxisTarget, scanGcodeWords, stripInlineComments } from '../gcode';
import type { MachineKind } from '../scene';
import { iterateLines } from '../util/iterate-lines';
import { sampleMotionArc } from './motion-manifest-arc';
import { polylineLength } from './motion-block-columns';
import { MotionBlockColumnsBuilder } from './motion-block-columns-builder';
import type {
  BuildMotionManifestOptions,
  MotionBlock,
  MotionBlockKind,
  MotionManifest,
  MotionPoint,
} from './motion-manifest';

const EPSILON = 1e-9;

type ModalState = {
  motion: 0 | 1 | 2 | 3;
  unitScale: number;
  absolute: boolean;
  position: MotionPoint;
  spindleArmed: boolean;
  power: number;
  /** Smoothieware only: the M221 S power scale as a fraction (Laser.cpp). */
  smoothieScale: number;
  readonly smoothieware: boolean;
};

type ParsedWords = {
  readonly values: ReadonlyMap<string, number>;
  readonly gCodes: ReadonlyArray<number>;
  readonly mCodes: ReadonlyArray<number>;
};

type ManifestBuildState = {
  readonly machineKind: MachineKind;
  readonly modal: ModalState;
  readonly blocks: MotionBlockColumnsBuilder;
  readonly parkBoundaries: number[];
  firstProcessPoint: MotionPoint | null;
  sendableLineIndex: number;
  routeMm: number;
};

export function buildMotionManifest(
  gcode: string,
  options: BuildMotionManifestOptions,
): MotionManifest {
  const initial = options.initialPosition ?? { x: 0, y: 0, z: 0 };
  const build: ManifestBuildState = {
    machineKind: options.machineKind,
    modal: initialModalState(initial, options.laserPowerControl === 'smoothieware'),
    blocks: new MotionBlockColumnsBuilder(lineCountUpperBound(gcode)),
    parkBoundaries: [],
    firstProcessPoint: null,
    sendableLineIndex: 0,
    routeMm: 0,
  };
  // One line at a time: the lines `split(/\r\n|\n|\r/)` gives, never all at once.
  let rawLineIndex = 0;
  for (const rawLine of iterateLines(gcode)) {
    appendManifestLine(build, rawLine, rawLineIndex);
    rawLineIndex += 1;
  }
  classifyParks(build.blocks, build.parkBoundaries);
  return {
    blocks: build.blocks.finish(),
    totalRouteMm: build.routeMm,
    sendableLineCount: build.sendableLineIndex,
    firstProcessPoint: build.firstProcessPoint,
    finalPoint: build.blocks.lastBlockPoint(),
  };
}

/** A line yields at most one block, so this sizes the block columns once. */
function lineCountUpperBound(gcode: string): number {
  let lines = 1;
  for (let index = 0; index < gcode.length; index += 1) {
    const character = gcode.charCodeAt(index);
    if (character === 10 || character === 13) lines += 1;
  }
  return lines;
}

// Smoothieware powers up with its M221 scale at 100%.
function initialModalState(position: MotionPoint, smoothieware: boolean): ModalState {
  return {
    motion: 0,
    unitScale: 1,
    absolute: true,
    position,
    spindleArmed: false,
    power: 0,
    smoothieScale: 1,
    smoothieware,
  };
}

function appendManifestLine(
  build: ManifestBuildState,
  rawLine: string,
  rawLineIndex: number,
): void {
  if (!isSendableGcodeLine(rawLine)) return;
  const sendableLineIndex = build.sendableLineIndex;
  build.sendableLineIndex += 1;
  const words = parseWords(stripInlineComments(rawLine));
  if (words.mCodes.some(isProgramStop)) build.parkBoundaries.push(rawLineIndex);
  applyModalState(build.modal, words);
  const points = motionPoints(build.modal, words);
  if (points === null) return;
  const lengthMm = polylineLength(points);
  if (lengthMm <= EPSILON) {
    updateModalPosition(build.modal, points);
    return;
  }
  const block = createMotionBlock(build, words, points, rawLineIndex, sendableLineIndex, lengthMm);
  build.blocks.push(block);
  if (build.firstProcessPoint === null && isMaterialEntry(build.machineKind, build.modal, block)) {
    build.firstProcessPoint = block.points[0] ?? null;
  }
  build.routeMm = block.routeEndMm;
  updateModalPosition(build.modal, points);
}

function isProgramStop(code: number): boolean {
  return code === 0 || code === 1;
}

function createMotionBlock(
  build: ManifestBuildState,
  words: ParsedWords,
  points: ReadonlyArray<MotionPoint>,
  rawLineIndex: number,
  sendableLineIndex: number,
  lengthMm: number,
): MotionBlock {
  return {
    rawLineIndex,
    sendableLineIndex,
    programLineNumber: words.values.get('N') ?? null,
    kind: classifyMotion(build.machineKind, build.modal, points),
    points,
    lengthMm,
    routeStartMm: build.routeMm,
    routeEndMm: build.routeMm + lengthMm,
  };
}

function updateModalPosition(state: ModalState, points: ReadonlyArray<MotionPoint>): void {
  state.position = points.at(-1) ?? state.position;
}

function isMaterialEntry(machineKind: MachineKind, state: ModalState, block: MotionBlock): boolean {
  if (block.kind === 'process') return true;
  if (machineKind !== 'cnc' || block.kind !== 'plunge' || state.motion === 0) return false;
  const from = block.points[0];
  const to = block.points.at(-1);
  return state.spindleArmed && from !== undefined && to !== undefined && to.z < from.z;
}

function parseWords(line: string): ParsedWords {
  const values = new Map<string, number>();
  const gCodes: number[] = [];
  const mCodes: number[] = [];
  for (const match of scanGcodeWords(line)) {
    if (!Number.isFinite(match.value)) continue;
    if (match.letter === 'G') gCodes.push(match.value);
    else if (match.letter === 'M') mCodes.push(match.value);
    else values.set(match.letter, match.value);
  }
  return { values, gCodes, mCodes };
}

function applyModalState(state: ModalState, words: ParsedWords): void {
  words.gCodes.forEach((code) => {
    applySharedGCode(state, code);
  });
  const power = words.values.get('S');
  // On Smoothieware M221's S is the percent scale, never the motion S.
  if (state.smoothieware && words.mCodes.includes(221)) {
    if (power !== undefined) state.smoothieScale = power / 100;
    return;
  }
  words.mCodes.forEach((code) => applyMCode(state, code));
  if (power !== undefined) state.power = power;
}

function applyMCode(state: ModalState, code: number): void {
  if (code === 3 || code === 4 || code === 106) state.spindleArmed = true;
  else if (code === 5 || code === 107) {
    state.spindleArmed = false;
    if (code === 107) state.power = 0;
  }
}

function motionPoints(state: ModalState, words: ParsedWords): ReadonlyArray<MotionPoint> | null {
  const hasAxis = ['X', 'Y', 'Z'].some((axis) => words.values.has(axis));
  if (!hasAxis) return null;
  const target = resolveTarget(state, words.values);
  if (state.motion !== 2 && state.motion !== 3) return [state.position, target];
  const i = words.values.get('I');
  const j = words.values.get('J');
  const r = words.values.get('R');
  return sampleMotionArc({
    from: state.position,
    to: target,
    clockwise: state.motion === 2,
    ...(i === undefined ? {} : { i }),
    ...(j === undefined ? {} : { j }),
    ...(r === undefined ? {} : { r }),
    unitScale: state.unitScale,
  });
}

function resolveTarget(state: ModalState, words: ReadonlyMap<string, number>): MotionPoint {
  return resolveAxisTarget(state.position, words, state);
}

function classifyMotion(
  machineKind: MachineKind,
  state: ModalState,
  points: ReadonlyArray<MotionPoint>,
): MotionBlockKind {
  // A closed arc ends where it started, so endpoint displacement is zero while the
  // path still sweeps the XY plane. Measure the travelled XY route instead, or a
  // full circle is classified as a vertical plunge and never counts as material
  // entry (ADR-271 mathematical contract, section 5).
  if (xyRouteLength(points) <= EPSILON) return 'plunge';
  if (state.motion === 0) return 'travel';
  if (machineKind === 'cnc') return state.spindleArmed ? 'process' : 'travel';
  // Smoothieware's laser module ignores M3/M4/M5: a G1-G3 fires at S times the
  // M221 scale (ADR-096 Amendment 1).
  if (state.smoothieware) return state.power > 0 && state.smoothieScale > 0 ? 'process' : 'travel';
  return state.spindleArmed && state.power > 0 ? 'process' : 'travel';
}

// Every park is found from the kinds as parsed and only then applied, so one
// boundary's park never hides the travel another boundary picks.
function classifyParks(
  blocks: MotionBlockColumnsBuilder,
  parkBoundaries: ReadonlyArray<number>,
): void {
  const lastProcess = lastBlockWhere(blocks.length, (index) => blocks.kindAt(index) === 'process');
  if (lastProcess < 0) return;
  const parkIndexes = new Set<number>();
  const finalParkIndex = lastBlockWhere(
    blocks.length,
    (index) => index > lastProcess && blocks.kindAt(index) === 'travel',
  );
  if (finalParkIndex >= 0) parkIndexes.add(finalParkIndex);
  for (const boundary of parkBoundaries) {
    // Blocks are in raw-line order, so those before the boundary are a prefix.
    const index = lastBlockWhere(
      firstBlockAtOrAfterLine(blocks, boundary),
      (candidate) => blocks.kindAt(candidate) === 'travel',
    );
    if (index >= 0) parkIndexes.add(index);
  }
  for (const index of parkIndexes) blocks.setKind(index, 'park');
}

function lastBlockWhere(end: number, matches: (index: number) => boolean): number {
  for (let index = end - 1; index >= 0; index -= 1) if (matches(index)) return index;
  return -1;
}

function firstBlockAtOrAfterLine(blocks: MotionBlockColumnsBuilder, rawLine: number): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (blocks.rawLineIndexAt(middle) < rawLine) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Distance travelled in the XY plane, ignoring Z, along the sampled path. */
function xyRouteLength(points: ReadonlyArray<MotionPoint>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
