// Value model for the clean-room PostScript subset reader (ADR-700).
// Reference: Adobe PostScript Language Reference, 3rd edition, chapters 3–4
// and 8 (operator definitions). Integers and reals share the JS number type;
// the few operators whose result depends on the distinction truncate.

import type { PsVm } from './ps-vm';

export type PsName = {
  readonly kind: 'name';
  readonly name: string;
  readonly literal: boolean;
};
export type PsString = { readonly kind: 'string'; value: string };
export type PsArray = { readonly kind: 'array'; readonly items: PsValue[]; exec: boolean };
export type PsDict = { readonly kind: 'dict'; readonly map: Map<string, PsValue> };
export type PsOperator = {
  readonly kind: 'operator';
  readonly name: string;
  readonly run: (vm: PsVm) => void;
};
export type PsMark = { readonly kind: 'mark' };
export type PsFile = { readonly kind: 'file' };
export type PsSave = { readonly kind: 'save' };

export type PsValue =
  | number
  | boolean
  | null
  | PsName
  | PsString
  | PsArray
  | PsDict
  | PsOperator
  | PsMark
  | PsFile
  | PsSave;

export type Vec = { readonly x: number; readonly y: number };
/** PostScript matrix [a b c d tx ty]: x' = a x + c y + tx, y' = b x + d y + ty. */
export type Matrix = readonly [number, number, number, number, number, number];

export type Segment =
  | { readonly kind: 'line'; readonly to: Vec }
  | { readonly kind: 'cubic'; readonly c1: Vec; readonly c2: Vec; readonly to: Vec };
export type Subpath = { readonly start: Vec; readonly segments: Segment[]; closed: boolean };

/** One painting operation, in device (default user space, point) coordinates. */
export type PaintedPath = {
  readonly subpaths: readonly Subpath[];
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly strokeWidth: number;
  readonly evenOdd: boolean;
};

/**
 * Why the reader stopped. `budget` is never caught by `stopped`: it protects
 * the app from a file that loops forever or grows without bound.
 */
export class PsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PsError';
  }
}

export const PS_MARK: PsMark = { kind: 'mark' };

export function psName(name: string, literal = true): PsName {
  return { kind: 'name', name, literal };
}

export function psString(value: string): PsString {
  return { kind: 'string', value };
}

export function psDict(): PsDict {
  return { kind: 'dict', map: new Map() };
}

export function isProcedure(value: PsValue): value is PsArray {
  return typeof value === 'object' && value !== null && value.kind === 'array' && value.exec;
}

/** Dictionary key text for a name, string or number key. */
export function dictKey(value: PsValue): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value.kind === 'name') return value.name;
  if (value.kind === 'string') return value.value;
  throw new PsError('typecheck', 'A dictionary key must be a name, string or number.');
}
