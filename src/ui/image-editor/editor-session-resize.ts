// Image Size / Canvas Size session ops (ADR-242, PP-E). Both replace the
// working document, so — like crop — the tile history cannot span them and
// clears (surfaced in the status row); Revert still restores the as-opened
// state (at the current resolution after an Image Size — documented delta).

import { createEditHistory, RGBA_CHANNELS, type RgbaBuffer } from '../../core/image-edit';
import { resampleBuffer } from '../../core/image-resample';
import type { EditorSession } from './editor-session';

/** Where existing pixels sit when the canvas grows or shrinks. */
export type CanvasAnchor = {
  /** 0 = left/top edge, 0.5 = centred, 1 = right/bottom edge. */
  readonly x: 0 | 0.5 | 1;
  readonly y: 0 | 0.5 | 1;
};

/**
 * Image Size: resample the document (and the Revert base + crop offset, so
 * the mm-bounds mapping in appliedBounds stays consistent — physical size
 * never changes, only pixel density).
 */
export function commitImageSize(
  session: EditorSession,
  width: number,
  height: number,
): EditorSession {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (w === session.doc.width && h === session.doc.height) return session;
  const scaleX = w / session.doc.width;
  const scaleY = h / session.doc.height;
  // Every layer resamples identically (ADR-245: uniform dimensions).
  const layers = session.layers.map((layer) => ({
    ...layer,
    buffer: resampleBuffer(layer.buffer, w, h),
  }));
  const active = layers.find((layer) => layer.id === session.activeLayerId) ?? layers[0];
  if (active === undefined) return session;
  return {
    ...session,
    doc: active.buffer,
    layers,
    activeLayerId: active.id,
    base: resampleBuffer(session.base, session.base.width * scaleX, session.base.height * scaleY),
    cropOffset: {
      x: Math.round(session.cropOffset.x * scaleX),
      y: Math.round(session.cropOffset.y * scaleY),
    },
    history: createEditHistory(),
    selection: null,
    revision: session.revision + 1,
    dirtySinceApply: true,
  };
}

/**
 * Canvas Size: change the document extent without scaling content — white
 * padding when growing, cropping when shrinking, content held at the anchor.
 * The crop offset absorbs the shift (negative = padding), so Apply maps the
 * new extent onto the workspace at the same pixel density.
 */
export function commitCanvasSize(
  session: EditorSession,
  width: number,
  height: number,
  anchor: CanvasAnchor,
): EditorSession {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (w === session.doc.width && h === session.doc.height) return session;
  const offsetX = Math.round((w - session.doc.width) * anchor.x);
  const offsetY = Math.round((h - session.doc.height) * anchor.y);
  // The Background pads opaque white (ADR-242 empty); upper layers pad
  // transparent so lower layers keep showing through (ADR-245).
  const layers = session.layers.map((layer, index) => ({
    ...layer,
    buffer: padBlit(layer.buffer, w, h, offsetX, offsetY, index === 0 ? 'white' : 'transparent'),
  }));
  const active = layers.find((layer) => layer.id === session.activeLayerId) ?? layers[0];
  if (active === undefined) return session;
  return {
    ...session,
    doc: active.buffer,
    layers,
    activeLayerId: active.id,
    cropOffset: { x: session.cropOffset.x - offsetX, y: session.cropOffset.y - offsetY },
    history: createEditHistory(),
    selection: null,
    revision: session.revision + 1,
    dirtySinceApply: true,
  };
}

// Copy the source into a w×h buffer at (offsetX, offsetY), clipping whatever
// falls outside; padding is opaque white or fully transparent.
function padBlit(
  source: RgbaBuffer,
  w: number,
  h: number,
  offsetX: number,
  offsetY: number,
  fill: 'white' | 'transparent',
): RgbaBuffer {
  const data = new Uint8ClampedArray(w * h * RGBA_CHANNELS);
  if (fill === 'white') data.fill(255);
  for (let y = 0; y < source.height; y += 1) {
    const ty = y + offsetY;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < source.width; x += 1) {
      const tx = x + offsetX;
      if (tx < 0 || tx >= w) continue;
      const src = (y * source.width + x) * RGBA_CHANNELS;
      const dst = (ty * w + tx) * RGBA_CHANNELS;
      for (let c = 0; c < RGBA_CHANNELS; c += 1) data[dst + c] = source.data[src + c] ?? 0;
    }
  }
  return { width: w, height: h, data };
}
