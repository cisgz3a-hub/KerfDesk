// Only the runtime's Array domain, not a machining policy or a work budget.
const MAX_ARRAY_LENGTH = 0xffff_ffff;

export class ReliefLevelArrayMaterializationError extends RangeError {
  constructor() {
    super('Relief roughing level count exceeds the ECMAScript Array length limit.');
  }
}

export function assertReliefLevelArrayLength(count: number): void {
  if (count > MAX_ARRAY_LENGTH) throw new ReliefLevelArrayMaterializationError();
}

// Count the actual binary64 loop predicate without allocating or iterating
// every fine step. Saturate only beyond the Array domain: that already proves
// the requested representation impossible. Comparing the original expression
// avoids changing a borderline level through division/ceil rounding.
export function reliefFineLevelCount(top: number, stop: number, stepMm: number): number {
  if (!(stepMm > 0)) return 0;
  let low = 0;
  let high = MAX_ARRAY_LENGTH + 1;
  if (top - high * stepMm > stop) return high;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (top - middle * stepMm > stop) low = middle;
    else high = middle;
  }
  return low;
}
