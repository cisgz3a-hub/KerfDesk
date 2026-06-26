import type { RawImageData } from '../../core/trace';

export type TraceRasterFixture = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly image: RawImageData;
};

export const LOGO_LIKE_TRACE_FIXTURE: TraceRasterFixture = buildLogoLikeFixture();
export const HOLLOW_LOGO_TRACE_FIXTURE: TraceRasterFixture = buildHollowLogoFixture();
export const TRANSPARENT_ALPHA_TRACE_FIXTURE: TraceRasterFixture = buildTransparentAlphaFixture();
export const SKETCH_CONTRAST_TRACE_FIXTURE: TraceRasterFixture = buildSketchContrastFixture();

function buildLogoLikeFixture(): TraceRasterFixture {
  const width = 128;
  const height = 128;
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const radius = 35;
  const stripeTop = 60;
  const stripeBottom = 68;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distToCenter = Math.hypot(x - cx, y - cy);
      const circleEdge = Math.abs(distToCenter - radius);
      let value = 255;
      if (distToCenter < radius - 1) value = 0;
      else if (circleEdge < 1) value = 128;
      if (y >= stripeTop && y < stripeBottom) value = 0;
      else if (y === stripeTop - 1 || y === stripeBottom) value = Math.min(value, 128);
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { name: 'logo-like', width, height, image: { width, height, data } };
}

function buildHollowLogoFixture(): TraceRasterFixture {
  const width = 128;
  const height = 128;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = isHollowLogoInk(x, y) ? 0 : 255;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { name: 'hollow-logo-like', width, height, image: { width, height, data } };
}

function buildTransparentAlphaFixture(): TraceRasterFixture {
  const width = 96;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inOpaqueLogo = x >= 30 && x < 66 && y >= 18 && y < 46;
      const offset = (y * width + x) * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = inOpaqueLogo ? 255 : 0;
    }
  }
  return { name: 'transparent-alpha', width, height, image: { width, height, data } };
}

function buildSketchContrastFixture(): TraceRasterFixture {
  const width = 96;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = isSketchContrastInk(x, y) ? 35 : 90;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { name: 'sketch-contrast', width, height, image: { width, height, data } };
}

function isHollowLogoInk(x: number, y: number): boolean {
  const inOuter = x >= 22 && x < 106 && y >= 20 && y < 108;
  const inHole = x >= 48 && x < 82 && y >= 44 && y < 84;
  const inSmallFeature = x >= 90 && x < 104 && y >= 92 && y < 100;
  return (inOuter && !inHole) || inSmallFeature;
}

function isSketchContrastInk(x: number, y: number): boolean {
  const horizontalStroke = x >= 22 && x < 74 && y >= 28 && y < 35;
  const leftStroke = x >= 22 && x < 29 && y >= 20 && y < 44;
  const rightStroke = x >= 67 && x < 74 && y >= 20 && y < 44;
  return horizontalStroke || leftStroke || rightStroke;
}
