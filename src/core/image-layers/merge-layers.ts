import { cloneRgbaBuffer, RGBA_CHANNELS, type RgbaBuffer } from '../image-edit';
import { compositeLayersInPlace } from './composite';
import type { EditorLayer } from './layer';

const MAX_BYTE = 255;

/**
 * Merge normal layers without a backdrop. Other blend pairs depend on what
 * is below them: bake that current appearance into a normal RGBA layer.
 * Both layer opacities are baked once; transparent coverage stays transparent.
 */
export function mergeLayerPixels(
  lower: EditorLayer,
  upper: EditorLayer,
  backdropLayers: readonly EditorLayer[],
): RgbaBuffer {
  const result: RgbaBuffer = {
    ...lower.buffer,
    data: new Uint8ClampedArray(lower.buffer.data.length),
  };
  if (lower.blend === 'normal' && upper.blend === 'normal') {
    mergeNormalPixels(result, lower, upper);
    return result;
  }
  const backdrop = cloneRgbaBuffer(result);
  backdrop.data.fill(MAX_BYTE);
  compositeLayersInPlace(backdrop, backdropLayers);
  const appearance = cloneRgbaBuffer(backdrop);
  compositeLayersInPlace(appearance, [lower, upper]);
  for (let base = 0; base < result.data.length; base += RGBA_CHANNELS) {
    const lowerAlpha = effectiveAlpha(lower, base);
    const upperAlpha = effectiveAlpha(upper, base);
    const alphaByte = Math.round((upperAlpha + lowerAlpha * (1 - upperAlpha)) * MAX_BYTE);
    if (alphaByte === 0) continue;
    const alpha = alphaByte / MAX_BYTE;
    for (let channel = 0; channel < 3; channel += 1) {
      const background = backdrop.data[base + channel] ?? 0;
      const visible = appearance.data[base + channel] ?? 0;
      result.data[base + channel] = Math.round((visible - background * (1 - alpha)) / alpha);
    }
    result.data[base + 3] = alphaByte;
  }
  return result;
}

function mergeNormalPixels(target: RgbaBuffer, lower: EditorLayer, upper: EditorLayer): void {
  for (let base = 0; base < target.data.length; base += RGBA_CHANNELS) {
    const upperAlpha = effectiveAlpha(upper, base);
    const retainedLower = effectiveAlpha(lower, base) * (1 - upperAlpha);
    const alpha = upperAlpha + retainedLower;
    if (alpha === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const premultiplied =
        (upper.buffer.data[base + channel] ?? 0) * upperAlpha +
        (lower.buffer.data[base + channel] ?? 0) * retainedLower;
      target.data[base + channel] = Math.round(premultiplied / alpha);
    }
    target.data[base + 3] = Math.round(alpha * MAX_BYTE);
  }
}

function effectiveAlpha(layer: EditorLayer, base: number): number {
  return layer.isVisible ? ((layer.buffer.data[base + 3] ?? 0) / MAX_BYTE) * layer.opacity : 0;
}
