// Corrections to catalog bits that a saved copy cannot pick up (ADR-322
// Amendment 2; 2026-09-25 PR audit, SET-1). Adding a catalog bit copies it whole
// into the custom library and the project's tool list, keeping the entry's
// catalogId, so a later catalog fix never reaches the copy. Each entry records
// what the catalog used to ship. A copy that still holds exactly that predates
// the fix; any other value is the operator's own and is left alone.
import type { CncTool } from '../../core/scene';
import type { CatalogTool } from './cnc-bit-catalog-types';
import { MODELED_CNC_BIT_CATALOG } from './cnc-bit-modeled-catalog';

type BitCorrection = {
  readonly catalogIds: ReadonlyArray<string>;
  readonly before: string;
  readonly effect: string;
  readonly describe: (fixed: CatalogTool) => string;
  readonly patch: (fixed: CatalogTool) => Partial<Pick<CncTool, 'fluteCount'>>;
  readonly predates: (tool: CncTool) => boolean;
};

// #894, 2026-09-24: both Amana O-flute ball-nose bits are single-flute
// (ToolsToday 51814 spec table, 51818 listing). The catalog shipped them with no
// flute count, so feeds assumed two flutes and doubled the chip load.
const BIT_CORRECTIONS: ReadonlyArray<BitCorrection> = [
  {
    catalogIds: ['o-ball-0125-amana-51814', 'o-ball-025-amana-51818'],
    before: 'no flute count, so feeds assume 2 flutes',
    effect: 'recipe feeds double the chip load on each flute',
    describe: (fixed) => fluteLabel(fixed.fluteCount ?? 0),
    patch: (fixed) => (fixed.fluteCount === undefined ? {} : { fluteCount: fixed.fluteCount }),
    predates: (tool) => tool.fluteCount === undefined,
  },
];

export type StaleCatalogBitCorrection = {
  readonly toolName: string;
  readonly before: string;
  readonly now: string;
  readonly effect: string;
  /** The catalog's corrected values, for the bit library's one-click offer. */
  readonly patch: Partial<Pick<CncTool, 'fluteCount'>>;
};

/** The corrections a saved catalog bit copy still predates; empty for any other bit. */
export function staleCatalogBitCorrections(
  tool: CncTool,
): ReadonlyArray<StaleCatalogBitCorrection> {
  const catalogId = tool.catalogId;
  if (catalogId === undefined) return [];
  const entry = MODELED_CNC_BIT_CATALOG.find((candidate) => candidate.id === catalogId);
  if (entry === undefined) return [];
  return BIT_CORRECTIONS.filter(
    (correction) => correction.catalogIds.includes(catalogId) && correction.predates(tool),
  ).map((correction) => ({
    toolName: tool.name,
    before: correction.before,
    now: correction.describe(entry.tool),
    effect: correction.effect,
    patch: correction.patch(entry.tool),
  }));
}

function fluteLabel(count: number): string {
  return count === 1 ? '1 flute' : `${count} flutes`;
}
