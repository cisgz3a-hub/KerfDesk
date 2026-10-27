// Block expansion budget (ADR-269 Amendment 1). Each INSERT copies its block's
// geometry, and a block can hold more INSERTs, so every level of a
// block-of-blocks chain multiplies the copies while each MINSERT grid stays
// within its own limit. That growth is not bounded by the input, so past the
// budget the import is refused, as SVG <use> expansion is (ADR-268 Amendment 1).

export const DXF_BLOCK_EXPANSION_LIMITS = {
  // Points any file may place through blocks, however small it is.
  floor: 500_000,
  // Beyond the floor, placed points per byte of the file. Writing a point takes
  // at least ten bytes ("10\n0\n20\n0\n"), so this is ten times what the file
  // could draw by itself.
  perFileByte: 1,
} as const;

export type DxfExpansionBudget = {
  /** Points placed through blocks so far, plus one per entity read inside a block. */
  placed: number;
  readonly limit: number;
};

export function createDxfExpansionBudget(fileBytes: number): DxfExpansionBudget {
  return {
    placed: 0,
    limit: Math.max(
      DXF_BLOCK_EXPANSION_LIMITS.floor,
      DXF_BLOCK_EXPANSION_LIMITS.perFileByte * fileBytes,
    ),
  };
}

/** The import is refused; `message` says why. */
export class DxfExpansionRefusal extends Error {}

/** Counts what placing blocks creates; refuses the import past the budget. */
export function spendDxfExpansion(budget: DxfExpansionBudget, points: number): void {
  budget.placed += points;
  if (budget.placed <= budget.limit) return;
  throw new DxfExpansionRefusal(
    `DXF block references expand to more than ${budget.limit.toLocaleString('en-US')} points, ` +
      'far more than the file holds; such files are refused because they expand without ' +
      'bound (for example, blocks of blocks of blocks). To import the drawing, explode its ' +
      'blocks in the CAD program first.',
  );
}
