import { REFERENCE_CNC_BIT_OPERATION_CATALOG } from './cnc-bit-reference-operation-catalog';
import { REFERENCE_CNC_BIT_SHAPE_CATALOG } from './cnc-bit-reference-shape-catalog';
import type { ReferenceCncBitCatalogEntry } from './cnc-bit-catalog-types';

export const REFERENCE_CNC_BIT_CATALOG: ReadonlyArray<ReferenceCncBitCatalogEntry> = [
  ...REFERENCE_CNC_BIT_SHAPE_CATALOG,
  ...REFERENCE_CNC_BIT_OPERATION_CATALOG,
];
