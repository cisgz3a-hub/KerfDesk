import type { RawImageData } from './trace-image';

/** The median must sample transparent paper as paper, regardless of hidden RGB.
 * Normal image imports already have these RGB values; preserve their identity. */
export function medianSourceOverPaper(image: RawImageData): RawImageData {
  let data: Uint8ClampedArray | undefined;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] !== 0) continue;
    if (image.data[i] === 255 && image.data[i + 1] === 255 && image.data[i + 2] === 255) continue;
    data ??= new Uint8ClampedArray(image.data);
    data[i] = data[i + 1] = data[i + 2] = 255;
  }
  return data === undefined ? image : { ...image, data };
}

/** Repair isolated high-contrast impulses without applying a full-frame median
 * to connected one-pixel strokes, counters, corners or unaffected colour. */
export function repairIsolatedMedianChanges(
  image: RawImageData,
  filtered: RawImageData,
  contrastDelta: number,
  minimumRatio: number,
): RawImageData {
  const pixels = image.width * image.height;
  if (pixels === 0) return image;
  const changes = new Uint8Array(pixels);
  let count = 0;
  for (let index = 0; index < pixels; index++) {
    if (image.data[index * 4 + 3] === 0) continue;
    const original = lumaAt(image.data, index);
    const median = lumaAt(filtered.data, index);
    if (Math.abs(original - median) <= contrastDelta) continue;
    if (hasConnectedSupport(image, index, original, median)) continue;
    changes[index] = 1;
    count++;
  }
  if (count === 0 || count / pixels < minimumRatio) return image;
  return applyMedianCorrections(image, filtered, changes);
}

function applyMedianCorrections(
  image: RawImageData,
  filtered: RawImageData,
  changes: Uint8Array,
): RawImageData {
  const data = new Uint8ClampedArray(image.data);
  for (let index = 0; index < changes.length; index++) {
    if (changes[index] !== 1) continue;
    const offset = index * 4;
    data[offset] = filtered.data[offset] ?? 255;
    data[offset + 1] = filtered.data[offset + 1] ?? 255;
    data[offset + 2] = filtered.data[offset + 2] ?? 255;
  }
  return { ...image, data };
}

// Three connected samples distinguish a continuation from an isolated one- or
// two-pixel impulse. Searching at most two links also protects an endpoint whose
// only immediate neighbour continues the stroke. Eight-connectivity handles
// diagonal strokes and rotated corners in the same way as horizontal ones.
function hasConnectedSupport(
  image: RawImageData,
  origin: number,
  original: number,
  median: number,
): boolean {
  const connected = [origin];
  const middle = (original + median) / 2;
  const darker = original < median;
  for (const current of connected) {
    const x = current % image.width;
    const y = Math.floor(current / image.width);
    for (const next of neighbours(x, y, image.width, image.height)) {
      if (connected.includes(next)) continue;
      const value = lumaAt(image.data, next);
      if (darker ? value >= middle : value <= middle) continue;
      connected.push(next);
      if (connected.length >= 3) return true;
    }
  }
  return false;
}

function* neighbours(x: number, y: number, width: number, height: number): Generator<number> {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) yield ny * width + nx;
    }
  }
}

function lumaAt(data: Uint8ClampedArray, index: number): number {
  const offset = index * 4;
  if (data[offset + 3] === 0) return 255;
  return (
    0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0)
  );
}
