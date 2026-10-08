import {
  productionPartRotations,
  productionStockCompatible,
} from './production-nest-compatibility';
import type {
  ProductionNestQuantity,
  ProductionNestResult,
  ProductionNestSheetLayout,
  ProductionNestingInput,
} from './production-nest';

export function describeProductionNest(
  input: ProductionNestingInput,
  sheets: ReadonlyArray<ProductionNestSheetLayout>,
): ProductionNestResult {
  const placements = sheets.flatMap((sheet) => sheet.placements);
  const quantities = input.definition.parts.map((part): ProductionNestQuantity => {
    const produced = placements.filter((placement) => placement.partId === part.id).length;
    return {
      partId: part.id,
      requested: part.quantity,
      produced,
      unplaced: part.quantity - produced,
      reason: produced === part.quantity ? '' : unplacedReason(input, part.id),
    };
  });
  const requested = quantities.reduce((count, quantity) => count + quantity.requested, 0);
  const produced = placements.length;
  const stockAreaMm2 = sheets.reduce((area, sheet) => {
    const stock = input.definition.sheets.find((stock) => stock.id === sheet.sheetId);
    return area + (stock === undefined ? 0 : stock.widthMm * stock.heightMm);
  }, 0);
  const occupiedAreaMm2 = sheets.reduce((area, sheet) => {
    const stock = input.definition.sheets.find((stock) => stock.id === sheet.sheetId);
    return (
      area +
      (stock === undefined
        ? 0
        : (sheet.stockUtilisationPercent * stock.widthMm * stock.heightMm) / 100)
    );
  }, 0);
  const vectorLengthMm = placements.reduce(
    (length, placement) =>
      length +
      (input.geometry.find((geometry) => geometry.partId === placement.partId)?.vectorLengthMm ??
        0),
    0,
  );
  return {
    sheets,
    quantities,
    requested,
    produced,
    unplaced: requested - produced,
    stockAreaMm2,
    occupiedAreaMm2,
    stockUtilisationPercent: stockAreaMm2 === 0 ? 0 : (occupiedAreaMm2 / stockAreaMm2) * 100,
    vectorLengthMm,
    placementTravelMm: sheets.reduce((travel, sheet) => travel + placementTravel(sheet), 0),
  };
}
function unplacedReason(input: ProductionNestingInput, partId: string): string {
  const part = input.definition.parts.find((part) => part.id === partId);
  if (part === undefined || !input.geometry.some((geometry) => geometry.partId === partId))
    return 'Source artwork or usable geometry is missing.';
  const compatible = input.definition.sheets.filter((stock) =>
    productionStockCompatible(part, stock),
  );
  if (compatible.length === 0) return 'No sheet matches the material and thickness.';
  if (!compatible.some((stock) => productionPartRotations(part, stock).length > 0))
    return 'No declared sheet grain and permitted rotation are compatible.';
  return 'The available sheet space does not fit every requested copy at this spacing.';
}
function placementTravel(sheet: ProductionNestSheetLayout): number {
  let x = 0,
    y = 0,
    total = 0;
  for (const placement of sheet.placements) {
    total += Math.hypot(placement.x - x, placement.y - y);
    x = placement.x;
    y = placement.y;
  }
  return total;
}
