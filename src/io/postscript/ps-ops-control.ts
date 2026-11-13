// Control, dictionary, array, string and environment operators (PLRM §8.1).
// Environment queries answer as a plain LanguageLevel 2 interpreter would, so
// prologs that probe for features take their simplest branch.

import { compositeSize, setEntry } from './ps-budget';
import type { OpTable } from './ps-ops-stack';
import { ExitSignal, HaltSignal, StopSignal, type PsVm } from './ps-vm';
import {
  PS_MARK,
  PsError,
  dictKey,
  psDict,
  psName,
  psString,
  type PsArray,
  type PsString,
  type PsValue,
} from './ps-types';

const MAX_COMPOSITE = 100_000;
const noop = (): void => undefined;
const popThen =
  (count: number, push?: (vm: PsVm) => void) =>
  (vm: PsVm): void => {
    for (let i = 0; i < count; i += 1) vm.pop();
    push?.(vm);
  };

export const CONTROL_OPS: OpTable = {
  exec: (vm) => vm.execute(vm.pop()),
  if: (vm) => {
    const proc = vm.popArray();
    if (vm.popBool()) vm.runProcedure(proc);
  },
  ifelse: (vm) => {
    const otherwise = vm.popArray();
    const then = vm.popArray();
    vm.runProcedure(vm.popBool() ? then : otherwise);
  },
  for: forOperator,
  repeat: (vm) => {
    const proc = vm.popArray();
    const count = vm.popInteger();
    loop(() => {
      for (let i = 0; i < count; i += 1) vm.runProcedure(proc);
    });
  },
  loop: (vm) => {
    const proc = vm.popArray();
    loop(() => {
      for (;;) vm.runProcedure(proc);
    });
  },
  forall: forallOperator,
  exit: () => {
    throw new ExitSignal();
  },
  stop: () => {
    throw new StopSignal();
  },
  stopped: (vm) => {
    const proc = vm.pop();
    try {
      vm.execute(proc);
      vm.push(false);
    } catch (error) {
      const recoverable =
        error instanceof StopSignal || (error instanceof PsError && error.code !== 'budget');
      if (!recoverable) throw error;
      vm.push(true);
    }
  },
  quit: () => {
    throw new HaltSignal();
  },
};

export const DICT_OPS: OpTable = {
  dict: (vm) => {
    vm.popInteger();
    vm.push(psDict());
  },
  begin: (vm) => {
    if (vm.dicts.length >= 64)
      throw new PsError('dictstackoverflow', 'Too many open dictionaries.');
    vm.dicts.push(vm.popDict());
  },
  end: (vm) => {
    if (vm.dicts.length <= 3) throw new PsError('dictstackunderflow', 'end without begin.');
    vm.dicts.pop();
  },
  def: (vm) => {
    const value = vm.pop();
    setEntry(vm.currentDict, dictKey(vm.pop()), value);
  },
  load: (vm) => {
    const key = dictKey(vm.pop());
    const value = vm.lookup(key);
    if (value === undefined) throw new PsError('undefined', `"${key}" is not defined.`);
    vm.push(value);
  },
  where: (vm) => {
    const key = dictKey(vm.pop());
    const dict = [...vm.dicts].reverse().find((d) => d.map.has(key));
    if (dict === undefined) vm.push(false);
    else {
      vm.push(dict);
      vm.push(true);
    }
  },
  known: (vm) => {
    const key = dictKey(vm.pop());
    vm.push(vm.popDict().map.has(key));
  },
  store: (vm) => {
    const value = vm.pop();
    const key = dictKey(vm.pop());
    const dict = [...vm.dicts].reverse().find((d) => d.map.has(key)) ?? vm.currentDict;
    setEntry(dict, key, value);
  },
  undef: (vm) => {
    const key = dictKey(vm.pop());
    vm.popDict().map.delete(key);
  },
  get: getOperator,
  put: putOperator,
  currentdict: (vm) => vm.push(vm.currentDict),
  countdictstack: (vm) => vm.push(vm.dicts.length),
  cleardictstack: (vm) => void vm.dicts.splice(3),
  maxlength: (vm) => vm.push(vm.popDict().map.size + 100),
  '<<': (vm) => vm.push(PS_MARK),
  '>>': (vm) => {
    const dict = psDict();
    const items = takeToMark(vm);
    if (items.length % 2 !== 0)
      throw new PsError('rangecheck', 'A dictionary needs key/value pairs.');
    for (let i = 0; i < items.length; i += 2)
      setEntry(dict, dictKey(items[i] ?? null), items[i + 1] ?? null);
    vm.push(dict);
  },
  '[': (vm) => vm.push(PS_MARK),
  ']': (vm) => vm.push({ kind: 'array', items: takeToMark(vm), exec: false }),
  array: (vm) =>
    vm.push({ kind: 'array', items: new Array<PsValue>(size(vm)).fill(null), exec: false }),
  astore: (vm) => {
    const array = vm.popArray();
    for (let i = array.items.length - 1; i >= 0; i -= 1) array.items[i] = vm.pop();
    vm.push(array);
  },
  aload: (vm) => {
    const array = vm.popArray();
    vm.charge(array.items.length);
    for (const item of array.items) vm.push(item);
    vm.push(array);
  },
  getinterval: (vm) => {
    const count = vm.popInteger();
    const start = vm.popInteger();
    const source = vm.pop();
    vm.charge(Math.max(0, Math.min(count, MAX_COMPOSITE)));
    if (typeof source === 'object' && source?.kind === 'string')
      vm.push(psString(source.value.slice(start, start + count)));
    else if (typeof source === 'object' && source?.kind === 'array')
      vm.push({
        kind: 'array',
        items: source.items.slice(start, start + count),
        exec: source.exec,
      });
    else throw new PsError('typecheck', 'getinterval needs a string or array.');
  },
  putinterval: putIntervalOperator,
  string: (vm) => vm.push(psString('\0'.repeat(size(vm)))),
  length: (vm) => vm.push(lengthOf(vm.pop())),
  cvs: (vm) => {
    vm.popString();
    vm.push(psString(textOf(vm.pop())));
  },
  cvn: (vm) => vm.push(psName(vm.popString().value, true)),
  cvx: (vm) => vm.push(withExec(vm.pop(), true)),
  cvlit: (vm) => vm.push(withExec(vm.pop(), false)),
  xcheck: (vm) => {
    const value = vm.pop();
    const exec =
      typeof value === 'object' &&
      value !== null &&
      ((value.kind === 'array' && value.exec) ||
        (value.kind === 'name' && !value.literal) ||
        value.kind === 'operator');
    vm.push(exec);
  },
  type: (vm) => vm.push(psName(typeName(vm.pop()), false)),
  search: searchOperator(false),
  anchorsearch: searchOperator(true),
  bind: noop,
  readonly: noop,
  executeonly: noop,
  noaccess: noop,
  rcheck: popThen(1, (vm) => vm.push(true)),
  wcheck: popThen(1, (vm) => vm.push(true)),
  gcheck: popThen(1, (vm) => vm.push(false)),
};

export const ENVIRONMENT_OPS: OpTable = {
  currentpacking: (vm) => vm.push(false),
  setpacking: popThen(1),
  currentglobal: (vm) => vm.push(false),
  setglobal: popThen(1),
  languagelevel: (vm) => vm.push(2),
  version: (vm) => vm.push(psString('3010')),
  product: (vm) => vm.push(psString('KerfDesk import')),
  revision: (vm) => vm.push(1),
  serialnumber: (vm) => vm.push(0),
  vmstatus: (vm) => [0, 0, 10_000_000].forEach((n) => vm.push(n)),
  realtime: (vm) => vm.push(0),
  usertime: (vm) => vm.push(0),
  print: popThen(1),
  '=': popThen(1),
  '==': popThen(1),
  flush: noop,
  pstack: noop,
  stack: noop,
  setpagedevice: popThen(1),
  currentpagedevice: (vm) => vm.push(psDict()),
  setdistillerparams: popThen(1),
  setuserparams: popThen(1),
  setsystemparams: popThen(1),
  setvmthreshold: popThen(1),
  setobjectformat: popThen(1),
  resourcestatus: popThen(2, (vm) => vm.push(false)),
  findresource: () => {
    throw new PsError('undefinedresource', 'The file needs a resource KerfDesk does not have.');
  },
  defineresource: (vm) => {
    vm.pop();
    const instance = vm.pop();
    vm.pop();
    vm.push(instance);
  },
  undefineresource: popThen(2),
};

function forOperator(vm: PsVm): void {
  const proc = vm.popArray();
  const limit = vm.popNumber();
  const step = vm.popNumber();
  const start = vm.popNumber();
  if (step === 0) throw new PsError('budget', 'A for loop never advances.');
  loop(() => {
    for (let i = start; step > 0 ? i <= limit : i >= limit; i += step) {
      vm.push(i);
      vm.runProcedure(proc);
    }
  });
}

function forallOperator(vm: PsVm): void {
  const proc = vm.popArray();
  const target = vm.pop();
  vm.charge(compositeSize(target));
  loop(() => {
    if (typeof target !== 'object' || target === null)
      throw new PsError('typecheck', 'forall needs an array, string or dictionary.');
    if (target.kind === 'array') for (const item of [...target.items]) callWith(vm, proc, [item]);
    else if (target.kind === 'string')
      for (const ch of target.value) callWith(vm, proc, [ch.charCodeAt(0)]);
    else if (target.kind === 'dict')
      for (const [key, value] of [...target.map]) callWith(vm, proc, [psName(key), value]);
    else throw new PsError('typecheck', 'forall needs an array, string or dictionary.');
  });
}

function callWith(vm: PsVm, proc: PsArray, values: readonly PsValue[]): void {
  for (const value of values) vm.push(value);
  vm.runProcedure(proc);
}

function loop(body: () => void): void {
  try {
    body();
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
}

function getOperator(vm: PsVm): void {
  const key = vm.pop();
  const source = vm.pop();
  if (typeof source !== 'object' || source === null)
    throw new PsError('typecheck', 'get needs an array, string or dictionary.');
  if (source.kind === 'dict') {
    const value = source.map.get(dictKey(key));
    if (value === undefined) throw new PsError('undefined', `"${dictKey(key)}" is not defined.`);
    vm.push(value);
  } else if (source.kind === 'array')
    vm.push(source.items[indexOf(key, source.items.length)] ?? null);
  else if (source.kind === 'string')
    vm.push(source.value.charCodeAt(indexOf(key, source.value.length)));
  else throw new PsError('typecheck', 'get needs an array, string or dictionary.');
}

function putOperator(vm: PsVm): void {
  const value = vm.pop();
  const key = vm.pop();
  const target = vm.pop();
  if (typeof target !== 'object' || target === null)
    throw new PsError('typecheck', 'put needs an array, string or dictionary.');
  if (target.kind === 'dict') setEntry(target, dictKey(key), value);
  else if (target.kind === 'array') target.items[indexOf(key, target.items.length)] = value;
  else if (target.kind === 'string' && typeof value === 'number') {
    const i = indexOf(key, target.value.length);
    target.value =
      target.value.slice(0, i) + String.fromCharCode(value & 0xff) + target.value.slice(i + 1);
  } else throw new PsError('typecheck', 'put needs an array, string or dictionary.');
}

function putIntervalOperator(vm: PsVm): void {
  const values = vm.pop();
  const start = vm.popInteger();
  const target = vm.pop();
  vm.charge(compositeSize(values));
  const arrays = [target, values].map(asArray);
  if (arrays[0] && arrays[1]) {
    const into = arrays[0];
    arrays[1].items.forEach((v, i) => (into.items[start + i] = v));
    return;
  }
  const strings = [target, values].map(asString);
  if (strings[0] && strings[1]) {
    const into = strings[0];
    const text = strings[1].value;
    into.value = into.value.slice(0, start) + text + into.value.slice(start + text.length);
    return;
  }
  throw new PsError('typecheck', 'putinterval needs matching strings or arrays.');
}

function asArray(value: PsValue): PsArray | null {
  return typeof value === 'object' && value?.kind === 'array' ? value : null;
}

function asString(value: PsValue): PsString | null {
  return typeof value === 'object' && value?.kind === 'string' ? value : null;
}

function indexOf(key: PsValue, length: number): number {
  if (typeof key !== 'number' || key < 0 || key >= length)
    throw new PsError('rangecheck', 'An index is out of range.');
  return Math.trunc(key);
}

function takeToMark(vm: PsVm): PsValue[] {
  const items: PsValue[] = [];
  for (;;) {
    const value = vm.pop();
    if (typeof value === 'object' && value?.kind === 'mark') return items.reverse();
    items.push(value);
  }
}

function size(vm: PsVm): number {
  const n = vm.popInteger();
  if (n < 0 || n > MAX_COMPOSITE)
    throw new PsError('limitcheck', 'An array or string is too large.');
  vm.charge(n); // a large allocation costs what it builds (ADR-700 Amd 2)
  return n;
}

const COMPOSITES: ReadonlySet<string> = new Set(['array', 'string', 'dict']);

function lengthOf(value: PsValue): number {
  if (typeof value === 'object' && value?.kind === 'name') return value.name.length;
  if (typeof value !== 'object' || value === null || !COMPOSITES.has(value.kind))
    throw new PsError('typecheck', 'length needs a composite.');
  return compositeSize(value);
}

function withExec(value: PsValue, exec: boolean): PsValue {
  if (typeof value !== 'object' || value === null) return value;
  if (value.kind === 'array') return { ...value, exec };
  if (value.kind === 'name') return psName(value.name, !exec);
  return value;
}

function textOf(value: PsValue): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value.kind === 'string') return value.value;
  if (value.kind === 'name' || value.kind === 'operator') return value.name;
  return '--nostringval--';
}

function typeName(value: PsValue): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integertype' : 'realtype';
  if (typeof value === 'boolean') return 'booleantype';
  if (value === null) return 'nulltype';
  const names: Readonly<Record<string, string>> = {
    name: 'nametype',
    string: 'stringtype',
    array: 'arraytype',
    dict: 'dicttype',
    operator: 'operatortype',
    mark: 'marktype',
    file: 'filetype',
    save: 'savetype',
  };
  return names[value.kind] ?? 'nulltype';
}

function searchOperator(anchored: boolean) {
  return (vm: PsVm): void => {
    const seek = vm.popString().value;
    const text = vm.popString().value;
    const at = anchored ? (text.startsWith(seek) ? 0 : -1) : text.indexOf(seek);
    if (at < 0) {
      vm.push(psString(text));
      vm.push(false);
      return;
    }
    if (!anchored) vm.push(psString(text.slice(at + seek.length)));
    else vm.push(psString(text.slice(seek.length)));
    vm.push(psString(seek));
    if (!anchored) vm.push(psString(text.slice(0, at)));
    vm.push(true);
  };
}
