import type { ProductionNestPart, ProductionNestStock } from './production-nest';
import type { NestRotation } from './quick-nest';

export function productionStockCompatible(
  part: ProductionNestPart,
  stock: ProductionNestStock,
): boolean {
  return (
    part.materialKey.trim().toLocaleLowerCase('en-US') ===
      stock.materialKey.trim().toLocaleLowerCase('en-US') &&
    Math.abs(part.thicknessMm - stock.thicknessMm) <= 1e-6
  );
}
export function productionPartRotations(
  part: ProductionNestPart,
  stock: ProductionNestStock,
): ReadonlyArray<NestRotation> {
  if (part.grain !== 'none' && stock.grain === 'none') return [];
  return [...new Set(part.rotationAngles)].filter((angle) => {
    if (![0, 90, 180, 270].includes(angle)) return false;
    if (part.grain === 'none') return true;
    const axis = angle % 180 === 0 ? part.grain : part.grain === 'x' ? 'y' : 'x';
    return axis === stock.grain;
  });
}
