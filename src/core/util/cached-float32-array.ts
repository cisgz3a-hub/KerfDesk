// Memoized ReadonlyArray<number> -> Float32Array conversion, keyed on the
// immutable object that owns the numbers.
//
// Relief meshes are the motivating case. ReliefObject.meshPositions is a plain
// number[] because that is what survives JSON round-tripping into .lf2, but
// every consumer wants a Float32Array, and four call sites rebuilt one
// independently: core/cnc/compile-cnc-relief.ts (twice — roughing and
// finishing), ui/relief-viewer/Relief3DViewerDialog.tsx, and
// ui/workspace/draw-relief.ts. On a 100 MB STL (~2 M triangles = 18 M floats)
// each rebuild is a measured ~620 ms and a fresh 72 MB allocation, and the
// compile path pays it twice per prepare — repeatedly, once the ADR-244 worker
// re-prepares after every edit.
//
// Entries are held weakly, so they die with the owner and cannot pin memory
// through the undo history. The cached source array is compared by reference on
// every read, so an owner that is mutated in place (rather than rebuilt by
// spread, as scene objects are) still gets a correct array rather than a stale
// one — the cache cannot go wrong, it can only miss.

type Entry = {
  readonly values: ReadonlyArray<number>;
  readonly array: Float32Array;
};

const entriesByOwner = new WeakMap<object, Entry>();

export function cachedFloat32Array(owner: object, values: ReadonlyArray<number>): Float32Array {
  const cached = entriesByOwner.get(owner);
  if (cached !== undefined && cached.values === values) return cached.array;
  const array = Float32Array.from(values);
  entriesByOwner.set(owner, { values, array });
  return array;
}
