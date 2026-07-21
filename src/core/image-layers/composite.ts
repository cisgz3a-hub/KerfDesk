// Layer compositing (ADR-245): bottom-up source-over / multiply, applied
// into a caller-owned target. The SAME function feeds the canvas preview
// and the Apply bake, so what the operator sees is byte-identical to what
// burns (Karpathy's law made structural).

import { RGBA_CHANNELS, type RgbaBuffer } from '../image-edit';
import type { EditorLayer } from './layer';

const MAX_BYTE = 255;

/**
 * Composite every visible layer (bottom-up, index 0 = Background) into
 * `target`, which the caller pre-fills (opaque white for the editor). All
 * buffers must share the target's dimensions.
 */
export function compositeLayersInPlace(target: RgbaBuffer, layers: readonly EditorLayer[]): void {
  for (const layer of layers) {
    if (!layer.isVisible || layer.opacity <= 0) continue;
    if (layer.buffer.width !== target.width || layer.buffer.height !== target.height) continue;
    blendLayerInPlace(target, layer);
  }
}

function blendLayerInPlace(target: RgbaBuffer, layer: EditorLayer): void {
  const pixels = target.width * target.height;
  for (let i = 0; i < pixels; i += 1) {
    const base = i * RGBA_CHANNELS;
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
