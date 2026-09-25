import { decode, type TiffIfd } from 'tiff';
import { validateTiffPixelLayout } from './tiff-pixel-layout';
import { tiffPageCount, topLeftTiffBytes } from './tiff-structure';

export type TiffPixels = {
  readonly width: number;
  readonly height: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  readonly densitySource: 'embedded' | 'default';
};

/** Decode one selected page at its original pixel grid, oriented for display. */
export function decodeTiffPage(bytes: Uint8Array, pageNumber: number): TiffPixels {
  const pages = tiffPageCount(bytes);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages) {
    throw new Error('This TIFF page does not exist.');
  }
  const options = { pages: [pageNumber - 1] };
  const header = decode(bytes, { ...options, ignoreImageData: true })[0];
  if (header === undefined) throw new Error('This TIFF page does not exist.');
  validateHeader(header);
  validateTiffPixelLayout(header, bytes.byteLength);
  const orientation = header.orientation || 1;
  const page = decode(orientation === 1 ? bytes : topLeftTiffBytes(bytes, pageNumber), options)[0];
  if (page === undefined) throw new Error('Could not decode this TIFF page.');
  page.fields.set(274, orientation);
  return pixelsForPage(page);
}

function validateHeader(page: TiffIfd): void {
  validateDimensions(page);
  validateChannels(page);
  validateSamples(page);
}

function validateDimensions(page: TiffIfd): void {
  const { width, height } = page;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid TIFF image dimensions.');
  }
  if (width > 16384 || height > 16384 || width * height > 268_435_456) {
    throw new Error(
      'This TIFF page exceeds the browser image limit. Export a smaller page as PNG.',
    );
  }
  const orientation = page.orientation || 1;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    throw new Error('Unsupported TIFF orientation.');
  }
}

function validateChannels(page: TiffIfd): void {
  const { components, type } = page;
  if (![0, 1, 2, 3].includes(type) || page.planarConfiguration !== 1) {
    throw new Error('Export this TIFF as interleaved RGB or greyscale before importing.');
  }
  const baseChannels = type === 2 ? 3 : 1;
  if (components !== baseChannels + (page.alpha ? 1 : 0)) {
    throw new Error('Unsupported TIFF extra channels.');
  }
  if (page.bitsPerSample === 1 && page.associatedAlpha) {
    throw new Error('Export premultiplied bilevel TIFF as RGB before importing.');
  }
}

function validateSamples(page: TiffIfd): void {
  const { sampleFormat, bitsPerSample, type } = page;
  if (sampleFormat !== 1 && sampleFormat !== 3)
    throw new Error('Signed TIFF samples are unsupported.');
  const supportedBits = sampleFormat === 3 ? [32, 64] : [1, 8, 16];
  if (!supportedBits.includes(bitsPerSample)) {
    throw new Error('Unsupported TIFF bit depth for this sample format.');
  }
  requireMatchingSamples(page.get('BitsPerSample'), bitsPerSample, 'bit depths');
  requireMatchingSamples(page.get('SampleFormat') ?? 1, sampleFormat, 'sample formats');
  if (sampleFormat === 3 && (type === 0 || page.associatedAlpha)) {
    throw new Error(
      'Export floating-point WhiteIsZero or premultiplied TIFF as RGB before importing.',
    );
  }
  if (type === 0 && page.alpha)
    throw new Error('WhiteIsZero TIFF with alpha must be exported as RGB.');
}

function requireMatchingSamples(values: unknown, expected: number, label: string): void {
  const samples = typeof values === 'number' ? [values] : Array.from(values as ArrayLike<unknown>);
  if (samples.some((value) => value !== expected)) {
    throw new Error('TIFF channels must have matching ' + label + '.');
  }
}

function pixelsForPage(page: TiffIfd): TiffPixels {
  const orientation = page.orientation || 1;
  const swapped = orientation >= 5;
  const width = swapped ? page.height : page.width;
  const height = swapped ? page.width : page.height;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const palette = page.type === 3 ? page.palette : undefined;
  const maximum = page.sampleFormat === 3 ? 1 : 2 ** page.bitsPerSample - 1;
  if (page.data.length !== page.width * page.height * page.components) {
    throw new Error('Incomplete TIFF pixel data.');
  }
  for (let y = 0; y < page.height; y += 1) {
    for (let x = 0; x < page.width; x += 1) {
      const source = (y * page.width + x) * page.components;
      const [dx, dy] = orientedPoint(x, y, page.width, page.height, orientation);
      const target = (dy * width + dx) * 4;
      writePixel(page, source, rgba, target, maximum, palette);
    }
  }
  const density = pageDensity(page);
  const xDpi = swapped ? density.y : density.x;
  const yDpi = swapped ? density.x : density.y;
  return {
    width,
    height,
    widthMm: (width * 25.4) / xDpi,
    heightMm: (height * 25.4) / yDpi,
    rgba,
    densitySource: density.source,
  };
}

function writePixel(
  page: TiffIfd,
  source: number,
  rgba: Uint8ClampedArray,
  target: number,
  maximum: number,
  palette: Array<[number, number, number]> | undefined,
): void {
  const value = page.data[source];
  const color = palette?.[value ?? -1];
  if (page.type === 3 && color === undefined) throw new Error('Invalid TIFF palette index.');
  const alpha = page.alpha ? sample(page.data[source + page.components - 1], maximum) : 1;
  for (let channel = 0; channel < 3; channel += 1) {
    // The upstream decoder already normalizes WhiteIsZero and associated
    // integer alpha. Do not invert or unpremultiply a second time.
    const component =
      color === undefined
        ? sample(page.data[source + (page.type === 2 ? channel : 0)], maximum)
        : sample(color[channel], 65535);
    rgba[target + channel] = Math.round((component * alpha + 1 - alpha) * 255);
  }
  rgba[target + 3] = 255;
}

function sample(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) throw new Error('Invalid TIFF pixel sample.');
  return Math.min(1, Math.max(0, value / maximum));
}

function pageDensity(page: TiffIfd): { x: number; y: number; source: 'embedded' | 'default' } {
  const scale = page.resolutionUnit === 3 ? 2.54 : 1;
  const x = page.xResolution * scale;
  const y = page.yResolution * scale;
  if (
    ![2, 3].includes(page.resolutionUnit) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 10 ||
    y < 10 ||
    x > 10000 ||
    y > 10000
  ) {
    return { x: 254, y: 254, source: 'default' };
  }
  return { x, y, source: 'embedded' };
}

function orientedPoint(
  x: number,
  y: number,
  w: number,
  h: number,
  orientation: number,
): [number, number] {
  switch (orientation) {
    case 2:
      return [w - 1 - x, y];
    case 3:
      return [w - 1 - x, h - 1 - y];
    case 4:
      return [x, h - 1 - y];
    case 5:
      return [y, x];
    case 6:
      return [h - 1 - y, x];
    case 7:
      return [h - 1 - y, w - 1 - x];
    case 8:
      return [y, w - 1 - x];
    default:
      return [x, y];
  }
}
