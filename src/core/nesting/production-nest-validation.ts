import { validateNest } from './outline-compact-nest';
import { nestRotation } from './quick-nest';
import {
  productionPartRotations,
  productionStockCompatible,
} from './production-nest-compatibility';
import type { ProductionNestResult, ProductionNestingInput } from './production-nest';

/** Independent proof reads declarations and actual placements, never trusts planner totals. */
export function validateProductionNest(
  input: ProductionNestingInput,
  result: ProductionNestResult,
): boolean {
  const placements = result.sheets.flatMap((sheet) => sheet.placements);
  if (
    new Set(result.sheets.map((sheet) => sheet.sheetId)).size !== result.sheets.length ||
    new Set(placements.map((placement) => placement.id)).size !== placements.length
  )
    return false;
  if (result.sheets.some((sheet) => !validSheet(input, sheet))) return false;
  const requested = input.definition.parts.reduce((count, part) => count + part.quantity, 0);
  if (
    result.requested !== requested ||
    result.produced !== placements.length ||
    result.unplaced !== requested - placements.length
  )
    return false;
  if (
    result.quantities.length !== input.definition.parts.length ||
    new Set(result.quantities.map((quantity) => quantity.partId)).size !== result.quantities.length
  )
    return false;
  return input.definition.parts.every((part) => {
    const quantity = result.quantities.find((quantity) => quantity.partId === part.id);
    const produced = placements.filter((placement) => placement.partId === part.id).length;
    return (
      quantity !== undefined &&
      quantity.requested === part.quantity &&
      quantity.produced === produced &&
      quantity.unplaced === part.quantity - produced &&
      produced <= part.quantity
    );
  });
}
function validSheet(
  input: ProductionNestingInput,
  sheet: ProductionNestResult['sheets'][number],
): boolean {
  const stock = input.definition.sheets.find((stock) => stock.id === sheet.sheetId);
  if (stock === undefined) return false;
  const items = sheet.placements.flatMap((placement) => {
    const part = input.definition.parts.find((part) => part.id === placement.partId);
    const geometry = input.geometry.find((geometry) => geometry.partId === placement.partId);
    if (part === undefined || geometry === undefined || !productionStockCompatible(part, stock))
      return [];
    if (
      !Number.isInteger(placement.copyIndex) ||
      placement.copyIndex < 0 ||
      placement.copyIndex >= part.quantity ||
      placement.id !== part.id + ':' + (placement.copyIndex + 1)
    )
      return [];
    const rotationAngles = productionPartRotations(part, stock);
    if (!rotationAngles.includes(nestRotation(placement))) return [];
    const { outline: _outline, ...rectangle } = geometry.item;
    return [
      { ...(sheet.usedOutline ? geometry.item : rectangle), id: placement.id, rotationAngles },
    ];
  });
  return (
    items.length === sheet.placements.length &&
    validateNest(
      { minX: 0, minY: 0, maxX: stock.widthMm, maxY: stock.heightMm },
      items,
      sheet.placements,
      { padding: input.definition.padding },
    )
  );
}
