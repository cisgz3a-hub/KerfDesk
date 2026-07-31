import { deriveBoxDims, type BoxSpec } from './box-spec';
import { edgePattern } from './edge-pattern';

const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const MAX_COUNT_BIGINT = BigInt(MAX_COUNT);

type Count = {
  readonly value: number;
  readonly isSaturated: boolean;
};

export type BoxWorkEstimate = {
  readonly kind: 'estimated';
  readonly axisCells: { readonly x: number; readonly y: number; readonly z: number };
  readonly junctionCells: number;
  readonly dividerCount: number;
  readonly crossLapPairs: number;
  readonly predictedParts: number;
  readonly predictedRings: number;
  readonly nominalPointUpper: number;
  /** Clearance-free upper for nominal + 24-gon relief Boolean input; advisory with offset. */
  readonly reliefBooleanInputVertexUpper: number;
  readonly claimCellVisits: number;
  readonly slotCellVisits: number;
  readonly dividerCellVisits: number;
  readonly fitMode: 'identity' | 'offset' | 'relief' | 'offset-and-relief';
  readonly saturatedFields: ReadonlyArray<string>;
};

/**
 * O(1), advisory-only structural estimate. It never validates, allocates from
 * a user count, or changes whether generation may run.
 */
export function estimateBoxWork(spec: BoxSpec): BoxWorkEstimate {
  const saturated = new Set<string>();
  const dims = deriveBoxDims(spec);
  const x = patternCount(spec, dims.outerWidthMm, 'axisCells.x', saturated);
  const y = patternCount(spec, dims.outerDepthMm, 'axisCells.y', saturated);
  const z = patternCount(spec, dims.outerHeightMm, 'axisCells.z', saturated);
  const dx = inputCount(spec.dividersXCount ?? 0, 'dividersX', saturated);
  const dy = inputCount(spec.dividersYCount ?? 0, 'dividersY', saturated);
  const dividerCount = sum('dividerCount', [[dx], [dy]], saturated);
  const junction = junctionCount(spec, dims.innerHeightMm, saturated);
  const tabCells = half(junction);
  const claimVisits = claimCellVisits(spec, x, y, z, saturated);
  const slotVisits = product('slotCellVisits', [dividerCount, junction], saturated);
  const dividerVisits = product('dividerCellVisits', [dividerCount, junction], saturated);
  const crossLaps = product('crossLapPairs', [dx, dy], saturated);
  const parts = sum('predictedParts', [[literal(basePartCount(spec))], [dividerCount]], saturated);
  const rings = sum('predictedRings', [[parts], [literal(2), dividerCount, tabCells]], saturated);
  const nominalPoints = nominalPointUpper(
    spec,
    { x, y, z, dividerCount, tabCells, dx, dy },
    saturated,
  );
  const reliefBooleanInput =
    spec.relief.kind === 'corner-overcut'
      ? product('reliefBooleanInputVertexUpper', [literal(25), nominalPoints], saturated)
      : literal(0);
  return {
    kind: 'estimated',
    axisCells: { x: x.value, y: y.value, z: z.value },
    junctionCells: junction.value,
    dividerCount: dividerCount.value,
    crossLapPairs: crossLaps.value,
    predictedParts: parts.value,
    predictedRings: rings.value,
    nominalPointUpper: nominalPoints.value,
    reliefBooleanInputVertexUpper: reliefBooleanInput.value,
    claimCellVisits: claimVisits.value,
    slotCellVisits: slotVisits.value,
    dividerCellVisits: dividerVisits.value,
    fitMode: fitMode(spec),
    saturatedFields: [...saturated],
  };
}

function patternCount(spec: BoxSpec, spanMm: number, field: string, saturated: Set<string>): Count {
  const count = edgePattern({
    fullSpanMm: spanMm,
    thicknessMm: spec.thicknessMm,
    targetFingerWidthMm: spec.targetFingerWidthMm,
  }).cellCount;
  return inputCount(count, field, saturated);
}

function junctionCount(spec: BoxSpec, innerHeightMm: number, saturated: Set<string>): Count {
  const heightSpanMm = spec.style === 'open-top' ? innerHeightMm + spec.thicknessMm : innerHeightMm;
  return patternCount(spec, heightSpanMm + 2 * spec.thicknessMm, 'junctionCells', saturated);
}

function claimCellVisits(
  spec: BoxSpec,
  x: Count,
  y: Count,
  z: Count,
  saturated: Set<string>,
): Count {
  return spec.style === 'closed'
    ? sum(
        'claimCellVisits',
        [
          [literal(8), x],
          [literal(8), y],
          [literal(8), z],
        ],
        saturated,
      )
    : sum(
        'claimCellVisits',
        [[literal(4), x], [literal(4), y], [literal(8), z], [literal(4)]],
        saturated,
      );
}

type EstimateCounts = {
  readonly x: Count;
  readonly y: Count;
  readonly z: Count;
  readonly dividerCount: Count;
  readonly tabCells: Count;
  readonly dx: Count;
  readonly dy: Count;
};

function nominalPointUpper(spec: BoxSpec, counts: EstimateCounts, saturated: Set<string>): Count {
  const base = baseOutlinePointUpper(spec, counts, saturated);
  const divider = sum(
    'nominalPointUpper',
    [
      [literal(5), counts.dividerCount],
      [literal(8), counts.dividerCount, counts.tabCells],
      [literal(8), counts.dx, counts.dy],
    ],
    saturated,
  );
  const slots = product(
    'nominalPointUpper',
    [literal(10), counts.dividerCount, counts.tabCells],
    saturated,
  );
  return sum('nominalPointUpper', [[base], [divider], [slots]], saturated);
}

function baseOutlinePointUpper(
  spec: BoxSpec,
  counts: Pick<EstimateCounts, 'x' | 'y' | 'z'>,
  saturated: Set<string>,
): Count {
  const { x, y, z } = counts;
  if (spec.style === 'closed') {
    return sum(
      'nominalPointUpper',
      [[literal(16), x], [literal(16), y], [literal(16), z], [literal(78)]],
      saturated,
    );
  }
  if (spec.style === 'open-top') {
    return sum(
      'nominalPointUpper',
      [[literal(8), x], [literal(8), y], [literal(16), z], [literal(73)]],
      saturated,
    );
  }
  return sum(
    'nominalPointUpper',
    [[literal(8), x], [literal(8), y], [literal(12), z], [literal(88)]],
    saturated,
  );
}

function fitMode(spec: BoxSpec): BoxWorkEstimate['fitMode'] {
  const hasOffset = spec.clearanceMm !== 0;
  const hasRelief = spec.relief.kind === 'corner-overcut';
  if (hasOffset && hasRelief) return 'offset-and-relief';
  if (hasOffset) return 'offset';
  return hasRelief ? 'relief' : 'identity';
}

function basePartCount(spec: BoxSpec): number {
  return spec.style === 'open-top' ? 5 : 6;
}

function inputCount(value: number, field: string, saturated: Set<string>): Count {
  if (Number.isSafeInteger(value) && value >= 0) return { value, isSaturated: false };
  saturated.add(field);
  return { value: MAX_COUNT, isSaturated: true };
}

function literal(value: number): Count {
  return { value, isSaturated: false };
}

function half(value: Count): Count {
  return value.isSaturated
    ? { value: MAX_COUNT, isSaturated: true }
    : { value: Math.floor(value.value / 2), isSaturated: false };
}

function product(field: string, factors: ReadonlyArray<Count>, saturated: Set<string>): Count {
  return sum(field, [factors], saturated);
}

function sum(
  field: string,
  terms: ReadonlyArray<ReadonlyArray<Count>>,
  saturated: Set<string>,
): Count {
  if (terms.some((term) => term.some((count) => count.isSaturated))) {
    saturated.add(field);
    return { value: MAX_COUNT, isSaturated: true };
  }
  let value = 0n;
  for (const term of terms) {
    value += term.reduce((accumulator, count) => accumulator * BigInt(count.value), 1n);
  }
  if (value > MAX_COUNT_BIGINT) {
    saturated.add(field);
    return { value: MAX_COUNT, isSaturated: true };
  }
  return { value: Number(value), isSaturated: false };
}
