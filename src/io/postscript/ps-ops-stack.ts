// Operand-stack, arithmetic, relational and boolean operators (PLRM §8.1).

import type { PsVm } from './ps-vm';
import { PS_MARK, PsError, type PsValue } from './ps-types';

export type OpTable = Readonly<Record<string, (vm: PsVm) => void>>;

const unary =
  (fn: (a: number) => number) =>
  (vm: PsVm): void =>
    vm.push(finite(fn(vm.popNumber())));
const binary =
  (fn: (a: number, b: number) => number) =>
  (vm: PsVm): void => {
    const b = vm.popNumber();
    const a = vm.popNumber();
    vm.push(finite(fn(a, b)));
  };
const compare =
  (fn: (a: number | string, b: number | string) => boolean) =>
  (vm: PsVm): void => {
    const b = comparable(vm.pop());
    const a = comparable(vm.pop());
    vm.push(fn(a, b));
  };
const logical =
  (bools: (a: boolean, b: boolean) => boolean, ints: (a: number, b: number) => number) =>
  (vm: PsVm): void => {
    const b = vm.pop();
    const a = vm.pop();
    if (typeof a === 'boolean' && typeof b === 'boolean') vm.push(bools(a, b));
    else if (typeof a === 'number' && typeof b === 'number') vm.push(ints(a, b));
    else throw new PsError('typecheck', 'Expected two booleans or two integers.');
  };

export const STACK_OPS: OpTable = {
  pop: (vm) => void vm.pop(),
  exch: (vm) => {
    const b = vm.pop();
    const a = vm.pop();
    vm.push(b);
    vm.push(a);
  },
  dup: (vm) => {
    const a = vm.pop();
    vm.push(a);
    vm.push(a);
  },
  copy: copyOperator,
  index: (vm) => {
    const n = vm.popInteger();
    const value = vm.operands[vm.operands.length - 1 - n];
    if (n < 0 || value === undefined) throw new PsError('rangecheck', 'index is out of range.');
    vm.push(value);
  },
  roll: rollOperator,
  clear: (vm) => void vm.operands.splice(0),
  count: (vm) => vm.push(vm.operands.length),
  mark: (vm) => vm.push(PS_MARK),
  cleartomark: (vm) => void vm.operands.splice(markIndex(vm)),
  counttomark: (vm) => vm.push(vm.operands.length - markIndex(vm) - 1),
  add: binary((a, b) => a + b),
  sub: binary((a, b) => a - b),
  mul: binary((a, b) => a * b),
  div: binary((a, b) => a / b),
  idiv: binary((a, b) => Math.trunc(Math.trunc(a) / Math.trunc(b))),
  mod: binary((a, b) => Math.trunc(a) % Math.trunc(b)),
  neg: unary((a) => -a),
  abs: unary(Math.abs),
  sqrt: unary(Math.sqrt),
  sin: unary((a) => Math.sin((a * Math.PI) / 180)),
  cos: unary((a) => Math.cos((a * Math.PI) / 180)),
  atan: binary((num, den) => {
    const deg = (Math.atan2(num, den) * 180) / Math.PI;
    return deg < 0 ? deg + 360 : deg;
  }),
  exp: binary((base, exponent) => base ** exponent),
  ln: unary(Math.log),
  log: unary(Math.log10),
  round: unary((a) => Math.floor(a + 0.5)),
  floor: unary(Math.floor),
  ceiling: unary(Math.ceil),
  truncate: unary(Math.trunc),
  cvi: (vm) => vm.push(Math.trunc(toNumber(vm.pop()))),
  cvr: (vm) => vm.push(toNumber(vm.pop())),
  rand: (vm) => vm.push(12345),
  srand: (vm) => void vm.pop(),
  rrand: (vm) => vm.push(0),
  eq: (vm) => vm.push(equal(vm.pop(), vm.pop())),
  ne: (vm) => vm.push(!equal(vm.pop(), vm.pop())),
  gt: compare((a, b) => a > b),
  ge: compare((a, b) => a >= b),
  lt: compare((a, b) => a < b),
  le: compare((a, b) => a <= b),
  and: logical(
    (a, b) => a && b,
    (a, b) => a & b,
  ),
  or: logical(
    (a, b) => a || b,
    (a, b) => a | b,
  ),
  xor: logical(
    (a, b) => a !== b,
    (a, b) => a ^ b,
  ),
  not: (vm) => {
    const a = vm.pop();
    if (typeof a === 'boolean') vm.push(!a);
    else if (typeof a === 'number') vm.push(~Math.trunc(a));
    else throw new PsError('typecheck', 'not expects a boolean or integer.');
  },
  bitshift: (vm) => {
    const shift = vm.popInteger();
    const value = vm.popInteger();
    vm.push(shift >= 0 ? value << shift : value >> -shift);
  },
  true: (vm) => vm.push(true),
  false: (vm) => vm.push(false),
  null: (vm) => vm.push(null),
};

function copyOperator(vm: PsVm): void {
  const top = vm.pop();
  if (typeof top === 'object' && top !== null && top.kind === 'dict') {
    const source = vm.popDict();
    for (const [key, value] of source.map) top.map.set(key, value);
    vm.push(top);
    return;
  }
  if (typeof top === 'object' && top !== null && top.kind === 'array') {
    const source = vm.popArray();
    source.items.forEach((item, i) => (top.items[i] = item));
    vm.push(top);
    return;
  }
  if (typeof top !== 'number' || top < 0) throw new PsError('typecheck', 'copy needs a count.');
  const n = Math.trunc(top);
  if (n > vm.operands.length) throw new PsError('stackunderflow', 'copy ran out of operands.');
  for (const value of vm.operands.slice(vm.operands.length - n)) vm.push(value);
}

function rollOperator(vm: PsVm): void {
  const j = vm.popInteger();
  const n = vm.popInteger();
  if (n < 0 || n > vm.operands.length) throw new PsError('rangecheck', 'roll is out of range.');
  if (n === 0) return;
  const items = vm.operands.splice(vm.operands.length - n, n);
  const shift = ((j % n) + n) % n;
  vm.operands.push(...items.slice(n - shift), ...items.slice(0, n - shift));
}

function markIndex(vm: PsVm): number {
  for (let i = vm.operands.length - 1; i >= 0; i -= 1) {
    const value = vm.operands[i];
    if (typeof value === 'object' && value?.kind === 'mark') return i;
  }
  throw new PsError('unmatchedmark', 'No mark on the operand stack.');
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new PsError('undefinedresult', 'A calculation in the file has no finite result.');
  return value;
}

function toNumber(value: PsValue): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value?.kind === 'string') {
    const parsed = Number(value.value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new PsError('typecheck', 'Expected a number.');
}

function comparable(value: PsValue): number | string {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value?.kind === 'string') return value.value;
  throw new PsError('typecheck', 'Only numbers or strings can be compared.');
}

export function equal(a: PsValue, b: PsValue): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const textA = a.kind === 'name' || a.kind === 'string' ? keyText(a) : null;
  const textB = b.kind === 'name' || b.kind === 'string' ? keyText(b) : null;
  return textA !== null && textA === textB;
}

function keyText(value: { kind: 'name'; name: string } | { kind: 'string'; value: string }) {
  return value.kind === 'name' ? value.name : value.value;
}
