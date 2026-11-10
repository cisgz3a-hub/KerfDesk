// Graphics-state, coordinate-system and colour operators (PLRM §8.1).

import { cmykHex, grayHex, hsbHex, rgbHex } from './ps-color';
import {
  apply,
  applyDelta,
  IDENTITY,
  invert,
  multiply,
  rotation,
  scaling,
  translation,
} from './ps-matrix';
import type { OpTable } from './ps-ops-stack';
import { copyGState, HaltSignal, newGState, type ColorSpace, type PsVm } from './ps-vm';
import { PsError, type Matrix, type PsArray, type PsValue } from './ps-types';

const noop = (): void => undefined;
const popThen =
  (count: number) =>
  (vm: PsVm): void => {
    for (let i = 0; i < count; i += 1) vm.pop();
  };

export const GSTATE_OPS: OpTable = {
  gsave: (vm) => saveGState(vm),
  grestore: (vm) => restoreGState(vm),
  grestoreall: (vm) => {
    while (vm.gstack.length > 0) restoreGState(vm);
  },
  save: (vm) => {
    saveGState(vm);
    vm.push({ kind: 'save' });
  },
  restore: (vm) => {
    vm.pop();
    restoreGState(vm);
  },
  initgraphics: (vm) => void (vm.gstate = newGState()),
  showpage: (vm) => {
    vm.note('showpage');
    throw new HaltSignal();
  },
  copypage: noop,
  erasepage: noop,
  translate: transformOperator(2, ([tx = 0, ty = 0]) => translation(tx, ty)),
  scale: transformOperator(2, ([sx = 1, sy = 1]) => scaling(sx, sy)),
  rotate: transformOperator(1, ([angle = 0]) => rotation(angle)),
  concat: (vm) => (vm.gstate.ctm = multiply(toMatrix(vm.popArray()), vm.gstate.ctm)),
  matrix: (vm) => vm.push(matrixArray(IDENTITY)),
  identmatrix: (vm) => vm.push(fillMatrix(vm.popArray(), IDENTITY)),
  defaultmatrix: (vm) => vm.push(fillMatrix(vm.popArray(), IDENTITY)),
  currentmatrix: (vm) => vm.push(fillMatrix(vm.popArray(), vm.gstate.ctm)),
  setmatrix: (vm) => (vm.gstate.ctm = toMatrix(vm.popArray())),
  initmatrix: (vm) => (vm.gstate.ctm = IDENTITY),
  concatmatrix: (vm) => {
    const out = vm.popArray();
    const m2 = toMatrix(vm.popArray());
    vm.push(fillMatrix(out, multiply(toMatrix(vm.popArray()), m2)));
  },
  invertmatrix: (vm) => {
    const out = vm.popArray();
    vm.push(fillMatrix(out, invert(toMatrix(vm.popArray()))));
  },
  transform: pointOperator((m, p) => apply(m, p)),
  dtransform: pointOperator((m, p) => applyDelta(m, p)),
  itransform: pointOperator((m, p) => apply(invert(m), p)),
  idtransform: pointOperator((m, p) => applyDelta(invert(m), p)),
  setlinewidth: (vm) => (vm.gstate.lineWidth = Math.abs(vm.popNumber())),
  currentlinewidth: (vm) => vm.push(vm.gstate.lineWidth),
  setlinecap: popThen(1),
  setlinejoin: popThen(1),
  setmiterlimit: popThen(1),
  setdash: (vm) => {
    vm.pop();
    if (vm.popArray().items.length > 0) vm.note('dash');
  },
  currentdash: (vm) => {
    vm.push({ kind: 'array', items: [], exec: false });
    vm.push(0);
  },
  setflat: popThen(1),
  setstrokeadjust: popThen(1),
  setoverprint: popThen(1),
  setsmoothness: popThen(1),
  setscreen: popThen(3),
  settransfer: popThen(1),
  sethalftone: popThen(1),
  setcolorrendering: popThen(1),
  setgray: (vm) => setColor(vm, { kind: 'gray' }, grayHex(vm.popNumber())),
  setrgbcolor: (vm) => {
    const [r = 0, g = 0, b = 0] = vm.popNumbers(3);
    setColor(vm, { kind: 'rgb' }, rgbHex(r, g, b));
  },
  setcmykcolor: (vm) => {
    const [c = 0, m = 0, y = 0, k = 0] = vm.popNumbers(4);
    setColor(vm, { kind: 'cmyk' }, cmykHex(c, m, y, k));
  },
  sethsbcolor: (vm) => {
    const [h = 0, s = 0, b = 0] = vm.popNumbers(3);
    setColor(vm, { kind: 'rgb' }, hsbHex(h, s, b));
  },
  setcolorspace: (vm) => setColorSpace(vm, vm.pop()),
  setcolor: (vm) => setColor(vm, vm.gstate.space, colorFromSpace(vm, vm.gstate.space)),
  currentgray: (vm) => vm.push(0),
  currentrgbcolor: (vm) => [0, 0, 0].forEach((n) => vm.push(n)),
  currentcmykcolor: (vm) => [0, 0, 0, 1].forEach((n) => vm.push(n)),
};

function saveGState(vm: PsVm): void {
  if (vm.gstack.length >= 256) throw new PsError('limitcheck', 'Too many nested gsave operations.');
  vm.gstack.push(copyGState(vm.gstate));
}

function restoreGState(vm: PsVm): void {
  const previous = vm.gstack.pop();
  if (previous !== undefined) vm.gstate = previous;
}

function setColor(vm: PsVm, space: ColorSpace, color: string): void {
  vm.gstate.space = space;
  vm.gstate.fill = color;
  vm.gstate.stroke = color;
}

const SPACE_ALIASES: Readonly<Record<string, 'gray' | 'rgb' | 'cmyk'>> = {
  DeviceGray: 'gray',
  CalGray: 'gray',
  DeviceRGB: 'rgb',
  CalRGB: 'rgb',
  DeviceCMYK: 'cmyk',
};

function setColorSpace(vm: PsVm, value: PsValue): void {
  const family = spaceFamily(value);
  const simple = SPACE_ALIASES[family];
  if (simple !== undefined) {
    const color = simple === 'cmyk' ? cmykHex(0, 0, 0, 1) : grayHex(0);
    setColor(vm, { kind: simple }, color);
    return;
  }
  if (family === 'Separation' && typeof value === 'object' && value?.kind === 'array') {
    const alt = SPACE_ALIASES[spaceFamily(value.items[2] ?? null)];
    const tint = value.items[3];
    if (alt !== undefined && typeof tint === 'object' && tint?.kind === 'array') {
      setColor(vm, { kind: 'separation', tint, alt }, grayHex(0));
      return;
    }
  }
  throw new PsError(
    'unsupported',
    `The file paints with a ${family} colour space, which KerfDesk cannot read.`,
  );
}

function spaceFamily(value: PsValue): string {
  if (typeof value === 'object' && value?.kind === 'name') return value.name;
  if (typeof value === 'object' && value?.kind === 'array')
    return spaceFamily(value.items[0] ?? null);
  return 'unknown';
}

function colorFromSpace(vm: PsVm, space: ColorSpace): string {
  if (space.kind === 'separation') {
    // Run the file's own tint transform into the alternate space.
    vm.runProcedure(space.tint);
    return colorFromSpace(vm, { kind: space.alt });
  }
  if (space.kind === 'gray') return grayHex(vm.popNumber());
  if (space.kind === 'rgb') {
    const [r = 0, g = 0, b = 0] = vm.popNumbers(3);
    return rgbHex(r, g, b);
  }
  const [c = 0, m = 0, y = 0, k = 0] = vm.popNumbers(4);
  return cmykHex(c, m, y, k);
}

function transformOperator(argCount: number, build: (args: number[]) => Matrix) {
  return (vm: PsVm): void => {
    const top = vm.operands[vm.operands.length - 1];
    if (typeof top === 'object' && top?.kind === 'array') {
      const out = vm.popArray();
      vm.push(fillMatrix(out, build(vm.popNumbers(argCount))));
      return;
    }
    vm.gstate.ctm = multiply(build(vm.popNumbers(argCount)), vm.gstate.ctm);
  };
}

function pointOperator(map: (m: Matrix, p: { x: number; y: number }) => { x: number; y: number }) {
  return (vm: PsVm): void => {
    const top = vm.operands[vm.operands.length - 1];
    const m =
      typeof top === 'object' && top?.kind === 'array' ? toMatrix(vm.popArray()) : vm.gstate.ctm;
    const [x = 0, y = 0] = vm.popNumbers(2);
    const p = map(m, { x, y });
    vm.push(p.x);
    vm.push(p.y);
  };
}

function toMatrix(array: PsArray): Matrix {
  const v = array.items;
  if (v.length !== 6 || !v.every((n) => typeof n === 'number' && Number.isFinite(n)))
    throw new PsError('typecheck', 'Expected a six-number matrix.');
  return v as unknown as Matrix;
}

function matrixArray(m: Matrix): PsArray {
  return { kind: 'array', items: [...m], exec: false };
}

function fillMatrix(out: PsArray, m: Matrix): PsArray {
  if (out.items.length !== 6) throw new PsError('rangecheck', 'A matrix needs six numbers.');
  m.forEach((value, i) => (out.items[i] = value));
  return out;
}
