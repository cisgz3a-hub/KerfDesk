// Which operation mode a freshly imported or traced object binds to. Split
// from scene-mutations so that module stays under the line cap.

import type { SceneObject } from '../../core/scene';
import { isHybridStrokePath } from '../../core/trace/hybrid/hybrid-paths';

// Line + fill (ADR-454): its strokes bind to a LINE operation and its
// outlines to a FILL operation, whatever the object-level mode says.
export function freshArtworkModeForColor(
  object: SceneObject,
): ((color: string) => 'line' | 'fill') | undefined {
  if (object.kind !== 'traced-image' || object.traceMode !== 'hybrid') return undefined;
  return (color) => (isHybridStrokePath({ color }) ? 'line' : 'fill');
}

/** Operation name suffixes for a Line + fill trace: its strokes and fills. */
export function freshArtworkNameForColor(
  object: SceneObject,
): ((color: string) => string | undefined) | undefined {
  if (object.kind !== 'traced-image' || object.traceMode !== 'hybrid') return undefined;
  return (color) => (isHybridStrokePath({ color }) ? 'lines' : 'fills');
}

export function freshArtworkMode(object: SceneObject): 'line' | 'fill' | 'image' {
  if (object.kind === 'raster-image') return 'image';
  if (object.kind === 'traced-image') {
    if (object.traceMode === 'centerline' || object.traceMode === 'edge') return 'line';
    return object.operationOverride?.mode ?? 'fill';
  }
  return object.operationOverride?.mode ?? 'line';
}
