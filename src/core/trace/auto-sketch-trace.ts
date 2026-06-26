import type { RawImageData } from './trace-image';

export type AutoSketchTraceOptions = {
  readonly sketchTrace?: boolean;
  readonly autoSketchTrace?: boolean;
};

export function shouldUseSketchTrace(
  image: RawImageData,
  options: AutoSketchTraceOptions,
): boolean {
  if (options.sketchTrace === true) return true;
  if (options.autoSketchTrace !== true) return false;
  return hasEnoughColourForAutoSketch(image);
}

function hasEnoughColourForAutoSketch(image: RawImageData): boolean {
  const pixelCount = image.width * image.height;
  if (pixelCount === 0) return false;
  let colourPixels = 0;
  const required = Math.max(32, Math.ceil(pixelCount * 0.002));
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const r = image.data[offset] ?? 255;
    const g = image.data[offset + 1] ?? 255;
    const b = image.data[offset + 2] ?? 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min >= 12 && lumaByte(r, g, b) < 245) {
      colourPixels += 1;
      if (colourPixels >= required) return true;
    }
  }
  return false;
}

function lumaByte(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}
