/**
 * T2-82: cheap, deterministic Scene memory estimator for the history
 * byte-budget. Pre-T2-82 the HistoryManager had only a count limit
 * (`maxSize=100`); 50 entries with 5MB images = 250MB, well over
 * what most browsers tolerate before slowdowns. T2-81 reduced
 * per-entry size by stripping `processedData`; T2-82 adds the
 * actual budget enforcement.
 *
 * The estimate is approximate — exact memory accounting is
 * impossible without runtime introspection. The audit's spec
 * suggests `JSON.stringify(scene).length` as a proxy, but
 * stringifying a multi-MB raster scene on every push is expensive.
 * This helper walks the scene structure and adds up the dominant
 * costs (image buffers, path segment counts) at constant cost per
 * object.
 *
 * Numbers are rough — over-estimating is safer (we'll evict
 * sooner, never under-budget).
 */

import type { Scene } from '../../core/scene/Scene';
import type { ImageGeometry, PathGeometry, PolygonGeometry } from '../../core/scene/SceneObject';

/** Flat per-object overhead: id + transform + metadata, in bytes. */
const PER_OBJECT_OVERHEAD = 256;
/** Overhead per layer entry. */
const PER_LAYER_OVERHEAD = 512;
/** Path segment cost (cubic = 6 numbers × 8 bytes; we round up for object overhead). */
const PER_PATH_SEGMENT = 64;
/** Polygon point cost. */
const PER_POLYGON_POINT = 16;
/** Text character cost (string + outlined glyph reference). */
const PER_TEXT_CHAR = 32;

export function estimateSceneBytes(scene: Scene): number {
  let total = 0;
  total += scene.layers.length * PER_LAYER_OVERHEAD;

  for (const obj of scene.objects) {
    total += PER_OBJECT_OVERHEAD;
    const g = obj.geometry;
    switch (g.type) {
      case 'image': {
        const img = g as ImageGeometry;
        // Uint8Array buffer length is the dominant cost for image-heavy
        // history. T2-81 strips `processedData`; we still account for
        // `grayscaleData` and `adjustedData` here.
        if (img.grayscaleData) total += img.grayscaleData.length;
        if (img.adjustedData) total += img.adjustedData.length;
        if (img.processedData) total += img.processedData.length;
        // src may be a data URI; assume small for indexeddb:// refs and
        // 2 bytes per char for inline.
        if (typeof img.src === 'string' && img.src.startsWith('data:')) {
          total += img.src.length * 2;
        }
        break;
      }
      case 'path': {
        const p = g as PathGeometry;
        for (const sp of p.subPaths) total += sp.segments.length * PER_PATH_SEGMENT;
        break;
      }
      case 'polygon': {
        const p = g as PolygonGeometry;
        total += p.points.length * PER_POLYGON_POINT;
        break;
      }
      case 'text': {
        total += (g.text?.length ?? 0) * PER_TEXT_CHAR;
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'line':
        // Already covered by PER_OBJECT_OVERHEAD; nothing extra.
        break;
      default: {
        const _exhaustive: never = g;
        void _exhaustive;
      }
    }
  }
  return total;
}
