// Dirty-window composite cache (V2 plan A1): reuse the previous composite
// buffer and recomposite only the pixels the last op touched. Pure logic —
// use-composite-doc.ts owns the ref — so the equivalence property (cached
// composite === fresh full composite) is testable headlessly.

import type { RgbaBuffer } from '../../core/image-edit';
import { compositeLayersInPlace } from '../../core/image-layers';
import type { EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';

export type CompositeCache = {
  readonly objectId: string;
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  /** Owned by the cache; recomposited in place across revisions. */
  readonly buffer: RgbaBuffer;
};

type CacheResult = {
  readonly doc: RgbaBuffer;
  readonly cache: CompositeCache | null;
};

/**
 * The composite for this session revision, reusing `cache` when only a
 * known window changed. Single plain-layer sessions return the document
 * itself (identity fast path) and carry no cache.
 */
export function nextComposite(cache: CompositeCache | null, session: EditorSession): CacheResult {
  const identity = compositeFastPath(session);
  if (identity !== null) return { doc: identity, cache: null };

  const reusable =
    cache !== null &&
    cache.objectId === session.objectId &&
    cache.width === session.doc.width &&
    cache.height === session.doc.height;

  if (reusable && cache.revision === session.revision) {
    return { doc: cache.buffer, cache };
  }

  // Exactly one revision ahead with a known window: patch the cache in
  // place. A larger jump means missed windows — rebuild fully.
  if (reusable && cache.revision === session.revision - 1 && session.lastDirtyRect !== null) {
    const rect = session.lastDirtyRect;
    if (rect.width > 0 && rect.height > 0) {
      fillWhite(cache.buffer, rect);
      compositeLayersInPlace(cache.buffer, session.layers, rect);
    }
    return {
      doc: cache.buffer,
      cache: { ...cache, revision: session.revision },
    };
  }

  const buffer = compositeSession(session);
  // compositeSession may hand back a shared identity buffer only on the
  // fast path, which was excluded above — this buffer is cache-owned.
  return {
    doc: buffer,
    cache: {
      objectId: session.objectId,
      width: session.doc.width,
      height: session.doc.height,
      revision: session.revision,
      buffer,
    },
  };
}

function compositeFastPath(session: EditorSession): RgbaBuffer | null {
  const only = session.layers.length === 1 ? session.layers[0] : undefined;
  if (
    only !== undefined &&
    only.isVisible &&
    only.opacity === 1 &&
    only.blend === 'normal' &&
    only.buffer === session.doc
  ) {
    return session.doc;
  }
  return null;
}

// The composite target is defined as "layers over opaque white" — the
// window must be reset before recompositing it.
function fillWhite(
  buffer: RgbaBuffer,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(buffer.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(buffer.height, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y += 1) {
    buffer.data.fill(255, (y * buffer.width + x0) * 4, (y * buffer.width + x1) * 4);
  }
}
