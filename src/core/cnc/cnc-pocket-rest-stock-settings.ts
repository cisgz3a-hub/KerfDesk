import type { CncPocketRestStockSettings } from '../scene/cnc-pocket-rest-stock';
import { isPositiveFiniteNumber } from '../util/finite';

export function normalizeCncPocketRestStock(raw: unknown): CncPocketRestStockSettings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const kind = value['kind'],
    previousToolId = value['previousToolId'];
  const previousToolDiameterMm = value['previousToolDiameterMm'],
    toleranceMm = value['toleranceMm'];
  if (kind !== 'rough-stage-stock' || !validIdentity(previousToolId)) return undefined;
  if (
    !isPositiveFiniteNumber(previousToolDiameterMm) ||
    previousToolDiameterMm > 1000 ||
    !isPositiveFiniteNumber(toleranceMm) ||
    toleranceMm < 0.002 ||
    toleranceMm >= previousToolDiameterMm / 2
  )
    return undefined;
  return { kind, previousToolId, previousToolDiameterMm, toleranceMm };
}
function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}
