// Rest machining and adaptive clearing plan the same pocket for every consumer
// of one output: the compile's passes, its roughing group and emit preflight
// each resolved it again (S8-P3-1: rest three times per export, adaptive
// twice). Preflight rebuilds its contours from the scene, so the arguments
// are equal but not the same objects. This memo keeps the last few results
// and returns one only when every argument is structurally the same: the same
// keys in the same order, and every leaf the same value by Object.is. The
// resolvers are pure, so a hit is the result a fresh call would return.

const DEFAULT_CAPACITY = 4;

type Entry<A extends ReadonlyArray<unknown>, R> = { readonly args: A; readonly result: R };

export function sameInputMemo<A extends ReadonlyArray<unknown>, R>(
  compute: (...args: A) => R,
  capacity = DEFAULT_CAPACITY,
): (...args: A) => R {
  const entries: Entry<A, R>[] = [];
  return (...args: A): R => {
    const index = entries.findIndex((entry) => sameValue(entry.args, args));
    const hit = entries[index];
    if (hit !== undefined) {
      // Most recently used last, so the oldest is dropped first.
      entries.splice(index, 1);
      entries.push(hit);
      return hit.result;
    }
    const result = compute(...args);
    entries.push({ args, result });
    if (entries.length > capacity) entries.shift();
    return result;
  };
}

/** Plain data equality: arrays and plain objects by structure and key order,
 *  anything else (a Map, a typed array, a class instance) by identity. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) return Array.isArray(b) && sameArray(a, b);
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  return sameRecord(a, b);
}

function sameArray(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (!sameValue(a[index], b[index])) return false;
  }
  return true;
}

function sameRecord(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(a);
  const other = Object.keys(b);
  if (keys.length !== other.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    if (key !== other[index] || !sameValue(a[key], b[key])) return false;
  }
  return true;
}

function isPlainObject(value: object): value is Readonly<Record<string, unknown>> {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
