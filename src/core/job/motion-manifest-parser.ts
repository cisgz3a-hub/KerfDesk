import { isSendableGcodeLine } from '../controllers/grbl';
import type { MachineKind } from '../scene';
import { sampleMotionArc } from './motion-manifest-arc';
import type {
  BuildMotionManifestOptions,
  MotionBlock,
  MotionBlockKind,
  MotionManifest,
  MotionPoint,
} from './motion-manifest';

const WORD = /([A-Za-z])[ \t]*([+-]?(?:\d+\.?\d*|\.\d+))/g;
const EPSILON = 1e-9;
const INCH_TO_MM = 25.4;

type ModalState = {
  motion: 0 | 1 | 2 | 3;
  unitScale: number;
  absolute: boolean;
  position: MotionPoint;
  spindleArmed: boolean;
  power: number;
};

type ParsedWords = {
  readonly values: ReadonlyMap<string, number>;
  readonly gCodes: ReadonlyArray<number>;
  readonly mCodes: ReadonlyArray<number>;
};

type ManifestBuildState = {
  readonly machineKind: MachineKind;
  readonly modal: ModalState;
  readonly blocks: MotionBlock[];
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
    modal: initialModalState(initial),
    blocks: [],
    parkBoundaries: [],
    firstProcessPoint: null,
    sendableLineIndex: 0,
    routeMm: 0,
  };
  for (const [rawLineIndex, rawLine] of gcode.split(/\r\n|\n|\r/).entries()) {
    appendManifestLine(build, rawLine, rawLineIndex);
  }
  const classified = classifyParks(build.blocks, build.parkBoundaries);
  return {
    blocks: classified,
    totalRouteMm: build.routeMm,
    sendableLineCount: build.sendableLineIndex,
    firstProcessPoint: build.firstProcessPoint,
    finalPoint: classified.at(-1)?.points.at(-1) ?? null,
  };
}

function initialModalState(position: MotionPoint): ModalState {
  return { motion: 0, unitScale: 1, absolute: true, position, spindleArmed: false, power: 0 };
}

function appendManifestLine(
  build: ManifestBuildState,
  rawLine: string,
  rawLineIndex: number,
): void {
  if (!isSendableGcodeLine(rawLine)) return;
  const sendableLineIndex = build.sendableLineIndex;
  build.sendableLineIndex += 1;
  const words = parseWords(stripComments(rawLine));
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

function stripComments(line: string): string {
  const noParens = line.replace(/\([^)]*\)/g, ' ');
  const semicolon = noParens.indexOf(';');
  return (semicolon < 0 ? noParens : noParens.slice(0, semicolon)).trim();
}

function parseWords(line: string): ParsedWords {
  const values = new Map<string, number>();
  const gCodes: number[] = [];
  const mCodes: number[] = [];
  for (const match of line.matchAll(WORD)) {
    const letter = (match[1] ?? '').toUpperCase();
    const value = Number.parseFloat(match[2] ?? '0');
    if (!Number.isFinite(value)) continue;
    if (letter === 'G') gCodes.push(value);
    else if (letter === 'M') mCodes.push(value);
    else values.set(letter, value);
  }
  return { values, gCodes, mCodes };
}

function applyModalState(state: ModalState, words: ParsedWords): void {
  words.gCodes.forEach((code) => applyGCode(state, code));
  words.mCodes.forEach((code) => applyMCode(state, code));
  const power = words.values.get('S');
  if (power !== undefined) state.power = power;
}

function applyGCode(state: ModalState, code: number): void {
  if (code === 0 || code === 1 || code === 2 || code === 3) state.motion = code;
  else if (code === 20) state.unitScale = INCH_TO_MM;
  else if (code === 21) state.unitScale = 1;
  else if (code === 90) state.absolute = true;
  else if (code === 91) state.absolute = false;
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
  const axis = (name: string, current: number): number => {
    const value = words.get(name);
    if (value === undefined) return current;
    const mm = value * state.unitScale;
    return state.absolute ? mm : current + mm;
  };
  return {
    x: axis('X', state.position.x),
    y: axis('Y', state.position.y),
    z: axis('Z', state.position.z),
  };
}

function classifyMotion(
  machineKind: MachineKind,
  state: ModalState,
  points: ReadonlyArray<MotionPoint>,
): MotionBlockKind {
  const from = points[0] ?? state.position;
  const to = points.at(-1) ?? from;
  const xyChanged = Math.hypot(to.x - from.x, to.y - from.y) > EPSILON;
  if (!xyChanged) return 'plunge';
  if (state.motion === 0) return 'travel';
  if (machineKind === 'cnc') return state.spindleArmed ? 'process' : 'travel';
  return state.spindleArmed && state.power > 0 ? 'process' : 'travel';
}

function classifyParks(
  blocks: ReadonlyArray<MotionBlock>,
  parkBoundaries: ReadonlyArray<number>,
): ReadonlyArray<MotionBlock> {
  const lastProcess = blocks.findLastIndex((block) => block.kind === 'process');
  if (lastProcess < 0) return blocks;
  const parkIndexes = new Set<number>();
  const finalParkIndex = blocks.findLastIndex(
    (block, index) => index > lastProcess && block.kind === 'travel',
  );
  if (finalParkIndex >= 0) parkIndexes.add(finalParkIndex);
  for (const boundary of parkBoundaries) {
    const index = blocks.findLastIndex(
      (block) => block.rawLineIndex < boundary && block.kind === 'travel',
    );
    if (index >= 0) parkIndexes.add(index);
  }
  return blocks.map((block, index) =>
    parkIndexes.has(index) ? { ...block, kind: 'park' } : block,
  );
}

function polylineLength(points: ReadonlyArray<MotionPoint>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) {
      length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
  }
  return length;
}
