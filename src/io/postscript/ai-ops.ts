// Native Adobe Illustrator 3–8 drawing operators (Adobe Illustrator File
// Format Specification, 1998, sections "Path Operators", "Painting
// Operators", "Color Operators", "Compound Paths" and "Text"). Illustrator
// files reference procsets they often do not carry, and the procsets
// themselves use far more of the language than artwork needs, so KerfDesk
// skips the prolog and gives these operators their documented meaning.
// Operators the reader does not draw with (layers, locking, guides, etc.)
// simply clear their operands.

import { cmykHex, grayHex, rgbHex } from './ps-color';
import type { OpTable } from './ps-ops-stack';
import type { PsVm } from './ps-vm';
import type { Subpath, Vec } from './ps-types';

type PaintMode = { fill: boolean; stroke: boolean };

export type AiState = {
  compound: Subpath[] | null;
  compoundMode: PaintMode | null;
  textDepth: number;
  evenOdd: boolean;
};

export function createAiState(): AiState {
  return { compound: null, compoundMode: null, textDepth: 0, evenOdd: false };
}

const pt = (x = 0, y = 0): Vec => ({ x, y });

export function aiOps(state: AiState): OpTable {
  const paint = (fill: boolean, stroke: boolean, close: boolean) => (vm: PsVm) =>
    paintAi(vm, state, { fill, stroke }, close);
  return {
    m: (vm) => {
      const [x, y] = vm.popNumbers(2);
      vm.moveTo(pt(x, y));
    },
    l: lineOp,
    L: lineOp,
    c: curveOp,
    C: curveOp,
    v: firstControlAtStart,
    V: firstControlAtStart,
    y: secondControlAtEnd,
    Y: secondControlAtEnd,
    h: (vm) => vm.closePath(),
    H: (vm) => vm.closePath(),
    N: paint(false, false, false),
    n: paint(false, false, true),
    F: paint(true, false, false),
    f: paint(true, false, true),
    S: paint(false, true, false),
    s: paint(false, true, true),
    B: paint(true, true, false),
    b: paint(true, true, true),
    W: (vm) => vm.note('clip'),
    '*u': () => {
      state.compound = [];
      state.compoundMode = null;
    },
    '*U': (vm) => endCompound(vm, state),
    g: (vm) => (vm.gstate.fill = grayHex(vm.popNumber())),
    G: (vm) => (vm.gstate.stroke = grayHex(vm.popNumber())),
    k: (vm) => (vm.gstate.fill = cmyk(vm.popNumbers(4))),
    K: (vm) => (vm.gstate.stroke = cmyk(vm.popNumbers(4))),
    x: (vm) => (vm.gstate.fill = customCmyk(vm)),
    X: (vm) => (vm.gstate.stroke = customCmyk(vm)),
    Xa: (vm) => (vm.gstate.fill = rgb(vm.popNumbers(3))),
    XA: (vm) => (vm.gstate.stroke = rgb(vm.popNumbers(3))),
    Xx: (vm) => (vm.gstate.fill = typedCustom(vm)),
    XX: (vm) => (vm.gstate.stroke = typedCustom(vm)),
    XR: (vm) => (state.evenOdd = vm.popInteger() === 1),
    w: (vm) => (vm.gstate.lineWidth = Math.abs(vm.popNumber())),
    d: (vm) => {
      vm.pop();
      if (vm.popArray().items.length > 0) vm.note('dash');
      clear(vm);
    },
    p: (vm) => patternFill(vm),
    P: (vm) => patternFill(vm),
    Bb: (vm) => {
      vm.note('gradient');
      clear(vm);
    },
    To: (vm) => {
      state.textDepth += 1;
      vm.note('text');
      clear(vm);
    },
    TO: (vm) => {
      state.textDepth = Math.max(0, state.textDepth - 1);
      vm.newPath();
      clear(vm);
    },
    XI: (vm) => imageSkipped(vm),
    XG: (vm) => imageSkipped(vm),
    XF: (vm) => imageSkipped(vm),
  };
}

/** `x2 y2 x3 y3 v`: the first control point is the current point. */
function firstControlAtStart(vm: PsVm): void {
  const [x2, y2, x3, y3] = vm.popNumbers(4);
  vm.curveTo(vm.currentUserPoint(), pt(x2, y2), pt(x3, y3));
}

/** `x1 y1 x3 y3 y`: the second control point is the end point. */
function secondControlAtEnd(vm: PsVm): void {
  const [x1, y1, x3, y3] = vm.popNumbers(4);
  vm.curveTo(pt(x1, y1), pt(x3, y3), pt(x3, y3));
}

function lineOp(vm: PsVm): void {
  const [x, y] = vm.popNumbers(2);
  vm.lineTo(pt(x, y));
}

function curveOp(vm: PsVm): void {
  const [x1, y1, x2, y2, x3, y3] = vm.popNumbers(6);
  vm.curveTo(pt(x1, y1), pt(x2, y2), pt(x3, y3));
}

function paintAi(vm: PsVm, state: AiState, mode: PaintMode, close: boolean): void {
  if (close) vm.closePath();
  // Text outlines and text paths are part of a skipped text object.
  if (state.textDepth > 0) {
    vm.newPath();
    return;
  }
  if (state.compound !== null) {
    state.compound.push(...vm.gstate.path.filter((s) => s.segments.length > 0));
    if (mode.fill || mode.stroke) state.compoundMode = mode;
    vm.newPath();
    return;
  }
  if (!mode.fill && !mode.stroke) {
    vm.newPath();
    return;
  }
  vm.paint({ ...mode, evenOdd: state.evenOdd });
}

function endCompound(vm: PsVm, state: AiState): void {
  const paths = state.compound ?? [];
  const mode = state.compoundMode;
  state.compound = null;
  state.compoundMode = null;
  if (mode === null || paths.length === 0) return;
  vm.gstate.path = paths;
  vm.paint({ ...mode, evenOdd: state.evenOdd });
}

function cmyk([c = 0, m = 0, y = 0, k = 0]: number[]): string {
  return cmykHex(c, m, y, k);
}

function rgb([r = 0, g = 0, b = 0]: number[]): string {
  return rgbHex(r, g, b);
}

/** `c m y k (name) tint x`: a tint of 0 is the full colour, 1 is none. */
function customCmyk(vm: PsVm): string {
  const tint = vm.popNumber();
  vm.pop();
  const coverage = 1 - Math.min(1, Math.max(0, tint));
  const [c = 0, m = 0, y = 0, k = 0] = vm.popNumbers(4);
  return cmykHex(c * coverage, m * coverage, y * coverage, k * coverage);
}

/** AI 8 `... (name) tint type Xx`: type 0 is CMYK, 1 is RGB. */
function typedCustom(vm: PsVm): string {
  const type = vm.popInteger();
  const tint = vm.popNumber();
  vm.pop();
  const coverage = 1 - Math.min(1, Math.max(0, tint));
  if (type === 1) {
    const [r = 0, g = 0, b = 0] = vm.popNumbers(3);
    const mix = (v: number): number => 1 - coverage * (1 - v);
    return rgbHex(mix(r), mix(g), mix(b));
  }
  const [c = 0, m = 0, y = 0, k = 0] = vm.popNumbers(4);
  return cmykHex(c * coverage, m * coverage, y * coverage, k * coverage);
}

function patternFill(vm: PsVm): void {
  vm.note('pattern');
  clear(vm);
}

function imageSkipped(vm: PsVm): void {
  vm.note('image');
  clear(vm);
}

function clear(vm: PsVm): void {
  vm.operands.splice(0);
}
