import { RGBA_CHANNELS, type RgbaBuffer } from '../../core/image-edit';

const OPAQUE_BYTE = 255;

/** Create an opaque-white RGBA fixture with positive integer dimensions. */
export function createEditorTestBuffer(width: number, height: number): RgbaBuffer {
  const data = new Uint8ClampedArray(width * height * RGBA_CHANNELS);
  data.fill(OPAQUE_BYTE);
  return { width, height, data };
}
