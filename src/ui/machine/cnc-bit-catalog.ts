// Researched CNC bit catalog for the Material & Bit panel. Addable generic
// entries are operator-matched nominal envelopes that map to a current
// cutting-envelope kernel; unsupported specialty geometry and motion remain
// visible as reference-only instead of being mislabeled as a flat end mill.

import { MODELED_CNC_BIT_CATALOG } from './cnc-bit-modeled-catalog';
import { REFERENCE_CNC_BIT_CATALOG } from './cnc-bit-reference-catalog';
import type { CncBitCatalogEntry } from './cnc-bit-catalog-types';

export { MODELED_CNC_BIT_CATALOG, REFERENCE_CNC_BIT_CATALOG };
export type {
  CatalogSourceScope,
  CncBitCatalogEntry,
  ModeledCncBitCatalogEntry,
  ReferenceCncBitCatalogEntry,
} from './cnc-bit-catalog-types';

export const CNC_BIT_CATALOG: ReadonlyArray<CncBitCatalogEntry> = [
  ...MODELED_CNC_BIT_CATALOG,
  ...REFERENCE_CNC_BIT_CATALOG,
];
