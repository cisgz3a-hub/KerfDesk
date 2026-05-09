import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';
import type { SceneObject } from '../../scene/SceneObject';

function hasNonFiniteNumber(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (value == null || typeof value !== 'object') return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber);

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (hasNonFiniteNumber(child)) return true;
  }
  return false;
}

function objectHasNonFiniteGeometry(obj: SceneObject): boolean {
  return hasNonFiniteNumber(obj.transform) || hasNonFiniteNumber(obj.geometry);
}

/**
 * T3-39: manually-constructed or corrupted scenes must fail before compile if
 * geometry contains NaN/Infinity. Load-time validation repairs normal project
 * files, but tests and integrations can still hand the compiler raw objects.
 */
export function runGeometryValidityChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const outputLayerIds = new Set(
    ctx.scene.layers
      .filter(layer => layer.visible !== false && layer.output !== false)
      .map(layer => layer.id),
  );

  for (const obj of ctx.scene.objects) {
    if (!obj.visible || !outputLayerIds.has(obj.layerId)) continue;
    if (!objectHasNonFiniteGeometry(obj)) continue;
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.GEOMETRY_NONFINITE,
      message: `Object "${obj.name || obj.id}" contains NaN or Infinity coordinates and cannot be safely compiled.`,
      objectId: obj.id,
      layerId: obj.layerId,
    });
  }
}
