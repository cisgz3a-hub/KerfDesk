import { legacyMeshIntrinsicBounds } from '../../core/relief/legacy-mesh';
import type { ReliefMeshIntrinsicBounds, ReliefMeshWidthAspect } from '../../core/scene/relief';
import type { RawProject } from './migrations';

/** Adds schema-v5 Float32 mesh geometry metadata without changing the embedded source coordinates. */
export function migrateV4ReliefMeshGeometry(raw: RawProject): RawProject {
  const scene = record(raw['scene']);
  if (scene === null || !Array.isArray(scene['objects'])) return { ...raw, schemaVersion: 5 };
  return {
    ...raw,
    schemaVersion: 5,
    scene: { ...scene, objects: scene['objects'].map(migrateObject) },
  };
}

function migrateObject(value: unknown): unknown {
  const object = record(value);
  const source = record(object?.['reliefSource']);
  if (object?.['kind'] !== 'relief' || source?.['kind'] !== 'legacy-mesh') return value;
  const positions = source['meshPositions'];
  if (!Array.isArray(positions)) return value;
  const intrinsicBounds = legacyMeshIntrinsicBounds(positions);
  const geometry = migratedTargetGeometry(object, intrinsicBounds);
  return {
    ...object,
    ...geometry,
    reliefSource: { ...source, intrinsicBounds },
  };
}

function migratedTargetGeometry(
  object: Record<string, unknown>,
  intrinsicBounds: ReliefMeshIntrinsicBounds,
): { readonly targetHeightMm: number; readonly widthAspect: ReliefMeshWidthAspect } {
  const targetWidthMm = object['targetWidthMm'];
  if (intrinsicBounds.kind === 'finite-float32-v1' && positiveFinite(targetWidthMm)) {
    const xExtent = intrinsicBounds.maxX - intrinsicBounds.minX;
    const yExtent = intrinsicBounds.maxY - intrinsicBounds.minY;
    const targetHeightMm = (yExtent / xExtent) * targetWidthMm;
    if (positiveFinite(xExtent) && positiveFinite(yExtent) && positiveFinite(targetHeightMm)) {
      return { targetHeightMm, widthAspect: 'preserve' };
    }
  }
  return { targetHeightMm: fallbackHeight(object, targetWidthMm), widthAspect: 'stretch' };
}

function fallbackHeight(object: Record<string, unknown>, targetWidthMm: unknown): number {
  const bounds = record(object['bounds']);
  const minY = bounds?.['minY'];
  const maxY = bounds?.['maxY'];
  if (typeof minY === 'number' && typeof maxY === 'number') {
    const height = maxY - minY;
    if (positiveFinite(height)) return height;
  }
  return positiveFinite(targetWidthMm) ? targetWidthMm : 1;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
