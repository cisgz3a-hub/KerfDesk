// grid-merge — folds one removal grid's depths into another. The simulate
// tier stamps each tool section with ITS OWN bit's kernel (ADR-271
// Amendment 1 clause 4), producing one grid per bit over the same spec;
// material that any bit removed stays removed, so deeper (more negative)
// always wins, mirroring carve-heightmap's min-combine.

/**
 * Cell-wise min of two equal-length depth fields, written into `target`.
 * Length mismatch merges nothing (the grids were stamped over different
 * specs, and a silent partial merge would draw a surface no job produces).
 */
export function mergeRemovalDepthsInto(target: Float32Array, source: Float32Array): void {
  if (target.length !== source.length) return;
  for (let index = 0; index < target.length; index += 1) {
    const deeper = source[index] ?? 0;
    const current = target[index] ?? 0;
    if (deeper < current) target[index] = deeper;
  }
}
