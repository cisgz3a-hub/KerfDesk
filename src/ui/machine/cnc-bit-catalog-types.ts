import type { CncTool } from '../../core/scene';

export type CatalogTool = Omit<CncTool, 'id' | 'catalogId'>;

export type CatalogSourceScope = 'exact-product' | 'family-reference' | 'representative-product';

export type ModeledCncBitCatalogEntry = {
  readonly status: 'modeled';
  readonly id: string;
  readonly family: string;
  readonly familyLabel: string;
  readonly tool: CatalogTool;
  readonly sourceUrl: string;
  readonly sourceScope: CatalogSourceScope;
};

export type ReferenceCncBitCatalogEntry = {
  readonly status: 'reference-only';
  readonly id: string;
  readonly familyLabel: string;
  readonly label: string;
  readonly reason: string;
  readonly sourceUrl: string;
  readonly sourceScope: CatalogSourceScope;
};

export type CncBitCatalogEntry = ModeledCncBitCatalogEntry | ReferenceCncBitCatalogEntry;
