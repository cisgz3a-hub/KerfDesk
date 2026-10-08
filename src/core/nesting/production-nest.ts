import type { OutlineNestItem } from './outline-compact-nest';
import type { NestGoal, NestLayout } from './layout-nest';
import type { NestPlacement, NestRotation } from './quick-nest';

export type ProductionGrain = 'none' | 'x' | 'y';
export type ProductionNestPart = {
  readonly id: string;
  readonly name: string;
  readonly objectIds: ReadonlyArray<string>;
  readonly quantity: number;
  readonly materialKey: string;
  readonly thicknessMm: number;
  readonly rotationAngles: ReadonlyArray<NestRotation>;
  readonly grain: ProductionGrain;
};
export type ProductionNestStock = {
  readonly id: string;
  readonly name: string;
  readonly stockId: string;
  readonly kind: 'sheet' | 'remnant';
  readonly materialKey: string;
  readonly thicknessMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly grain: ProductionGrain;
};
export type ProductionNestDefinition = {
  readonly id: string;
  readonly name: string;
  readonly parts: ReadonlyArray<ProductionNestPart>;
  readonly sheets: ReadonlyArray<ProductionNestStock>;
  readonly padding: number;
  readonly goal: NestGoal;
  readonly method: 'fast' | 'outline';
  readonly optimise: boolean;
  /** Generated sheet provenance; source-design part identities remain stable. */
  readonly output?:
    | {
        readonly sheetId: string;
        readonly instances: ReadonlyArray<{
          readonly partId: string;
          readonly instanceId: string;
          readonly objectIds: ReadonlyArray<string>;
        }>;
      }
    | undefined;
};
export type ProductionNestingInput = {
  readonly definition: ProductionNestDefinition;
  readonly geometry: ReadonlyArray<{
    readonly partId: string;
    readonly item: OutlineNestItem;
    readonly vectorLengthMm: number;
  }>;
};
export type ProductionNestPlacement = NestPlacement & {
  readonly partId: string;
  readonly copyIndex: number;
};
export type ProductionNestSheetLayout = Omit<NestLayout, 'placements'> & {
  readonly sheetId: string;
  readonly placements: ReadonlyArray<ProductionNestPlacement>;
};
export type ProductionNestQuantity = {
  readonly partId: string;
  readonly requested: number;
  readonly produced: number;
  readonly unplaced: number;
  readonly reason: string;
};
export type ProductionNestResult = {
  readonly sheets: ReadonlyArray<ProductionNestSheetLayout>;
  readonly quantities: ReadonlyArray<ProductionNestQuantity>;
  readonly requested: number;
  readonly produced: number;
  readonly unplaced: number;
  readonly stockAreaMm2: number;
  readonly occupiedAreaMm2: number;
  readonly stockUtilisationPercent: number;
  /** Geometry/placement estimates; executable CNC lengths remain compilation facts. */
  readonly vectorLengthMm: number;
  readonly placementTravelMm: number;
};
export type ProductionNestingProgress = {
  readonly attempted: number;
  readonly total: number;
  readonly best: ProductionNestResult | null;
};
