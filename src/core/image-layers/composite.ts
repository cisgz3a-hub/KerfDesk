// Layer compositing (ADR-245): bottom-up source-over / multiply, applied
// into a caller-owned target. The SAME function feeds the canvas preview
// and the Apply bake, so what the operator sees is byte-identical to what
// burns (Karpathy's law made structural).

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { EditorLayer } from './layer';

const MAX_BYTE = 255;

/**
 * Composite every visible layer (bottom-up, index 0 = Background) into
 * `target`, which the caller pre-fills (opaque white for the editor). All
 * buffers must share the target's dimensions. An optional rect limits the
 * work to that window (dirty-tile compositing) — omitted = full document.
 */
export function compositeLayersInPlace(
  target: RgbaBuffer,
  layers: readonly EditorLayer[],
  rect?: PixelRect,
): void {
  const window = clampWindow(target, rect);
  if (window.width <= 0 || window.height <= 0) return;
  for (const layer of layers) {
    if (!layer.isVisible || layer.opacity <= 0) continue;
    if (layer.buffer.width !== target.width || layer.buffer.height !== target.height) continue;
    blendLayerInPlace(target, layer, window);
  }
}

function clampWindow(target: RgbaBuffer, rect: PixelRect | undefined): PixelRect {
  if (rect === undefined) return { x: 0, y: 0, width: target.width, height: target.height };
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  return {
    x,
    y,
    width: Math.min(target.width, Math.ceil(rect.x + rect.width)) - x,
    height: Math.min(target.height, Math.ceil(rect.y + rect.height)) - y,
  };
}

function blendLayerInPlace(target: RgbaBuffer, layer: EditorLayer, window: PixelRect): void {
  for (let y = window.y; y < window.y + window.height; y += 1) {
    for (let x = window.x; x < window.x + window.width; x += 1) {
      const base = (y * target.width + x) * RGBA_CHANNELS;
      const srcAlpha = ((layer.buffer.data[base + 3] ?? 0) / MAX_BYTE) * layer.opacity;
      if (srcAlpha <= 0) continue;
      for (let c = 0; c < 3; c += 1) {
        const dst = target.data[base + c] ?? 0;
        const src = layer.buffer.data[base + c] ?? 0;
        const blended = layer.blend === 'multiply' ? (dst * src) / MAX_BYTE : src;
        target.data[base + c] = Math.round(dst + (blended - dst) * srcAlpha);
      }
      // The editor's composite stays opaque: it sits over the white target.
      target.data[base + 3] = MAX_BYTE;
    }
  }
}
