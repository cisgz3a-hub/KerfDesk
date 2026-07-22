// Editor layer model (ADR-245): a doc-sized RGBA buffer with visibility,
// opacity, and one of the two engrave-meaningful blend modes. Ids come from
// the caller (core generates no randomness — ADR-242 purity rules).

import { RGBA_CHANNELS, type RgbaBuffer } from '../image-edit';

export type LayerBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'difference';

export type EditorLayer = {
  readonly id: string;
  readonly name: string;
  /** Mutable via the *InPlace op contract when this is the active layer. */
  readonly buffer: RgbaBuffer;
  readonly isVisible: boolean;
  /** 0..1 */
  readonly opacity: number;
  readonly blend: LayerBlend;
};

export type LayerFill = 'white' | 'transparent';

/**
 * Create a layer. The Background layer is opaque white (the ADR-242
 * white-is-empty convention); layers above start fully transparent so lower
 * layers show through until painted.
 */
export function createLayer(
  id: string,
  name: string,
  width: number,
  height: number,
  fill: LayerFill,
): EditorLayer {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * RGBA_CHANNELS);
  if (fill === 'white') data.fill(255);
  return {
    id,
    name,
    buffer: { width: w, height: h, data },
    isVisible: true,
    opacity: 1,
    blend: 'normal',
  };
}

/** Wrap an existing buffer (the decoded source) as the Background layer. */
export function layerFromBuffer(id: string, name: string, buffer: RgbaBuffer): EditorLayer {
  return { id, name, buffer, isVisible: true, opacity: 1, blend: 'normal' };
}
