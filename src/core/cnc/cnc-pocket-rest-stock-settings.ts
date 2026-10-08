import type { CncPocketRestStockSettings } from '../scene/cnc-pocket-rest-stock';

export function normalizeCncPocketRestStock(raw: unknown): CncPocketRestStockSettings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const kind = value['kind'],
    previousToolId = value['previousToolId'];
  const previousToolDiameterMm = value['previousToolDiameterMm'],
    toleranceMm = value['toleranceMm'];
  if (kind !== 'rough-stage-stock' || !validIdentity(previousToolId)) return undefined;
  if (
    !positive(previousToolDiameterMm) ||
    previousToolDiameterMm > 1000 ||
    !positive(toleranceMm) ||
    toleranceMm < 0.002 ||
    toleranceMm >= previousToolDiameterMm / 2
  )
    return undefined;
  return { kind, previousToolId, previousToolDiameterMm, toleranceMm };
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}
