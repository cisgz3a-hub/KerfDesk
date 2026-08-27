/** Typed mesh storage that keeps ordinary Float32 behavior but never overflows a finite source. */
export type FinitePreservingFloatArray = Float32Array | Float64Array;

type MeshPositionValues = ReadonlyArray<number> | FinitePreservingFloatArray;

type Entry = {
  readonly values: MeshPositionValues;
  readonly array: FinitePreservingFloatArray;
};

const entriesByOwner = new WeakMap<object, Entry>();

/**
 * Retains the existing compact Float32 representation unless it would turn a finite coordinate
 * into infinity. The exceptional source then stays binary64 instead of becoming invalid geometry.
 */
export function finitePreservingFloatArray(
  values: ReadonlyArray<number>,
): FinitePreservingFloatArray {
  for (const value of values) {
    if (Number.isFinite(value) && !Number.isFinite(Math.fround(value))) {
      return Float64Array.from(values);
    }
  }
  return Float32Array.from(values);
}

/** Owner-keyed conversion for immutable persisted legacy-mesh sources. */
export function cachedFinitePreservingFloatArray(
  owner: object,
  values: MeshPositionValues,
): FinitePreservingFloatArray {
  const cached = entriesByOwner.get(owner);
  if (cached !== undefined && cached.values === values) return cached.array;
  const array =
    values instanceof Float32Array || values instanceof Float64Array
      ? values
      : finitePreservingFloatArray(values);
  entriesByOwner.set(owner, { values, array });
  return array;
}
