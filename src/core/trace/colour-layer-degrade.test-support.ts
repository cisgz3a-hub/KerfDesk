// Real-image degradations for the colour-layer trace tests (ADR-461
// Amendment 3): a baseline JPEG round trip, a Gaussian blur and grain.
//
// The JPEG round trip applies every lossy step of a baseline encoder and
// decoder: JFIF YCbCr, 4:2:0 chroma (2 x 2 mean, then the triangle-filter
// upsampling libjpeg uses by default), the 8 x 8 DCT, and quantisation by the
// ITU-T T.81 Annex K tables scaled to a quality as the IJG library scales
// them. Entropy coding is lossless, so the decoded pixels carry a real
// encoder's ringing and blocking without a binary fixture or a codec.
import type { RawImageData } from './trace-image';

// ITU-T T.81 Annex K, tables K.1 (luminance) and K.2 (chrominance).
const LUMA_TABLE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_TABLE = [
  17,
  18,
  24,
  47,
  99,
  99,
  99,
  99,
  18,
  21,
  26,
  66,
  99,
  99,
  99,
  99,
  24,
  26,
  56,
  99,
  99,
  99,
  99,
  99,
  47,
  66,
  99,
  99,
  99,
  99,
  99,
  99,
  ...new Array<number>(32).fill(99),
];

// Orthonormal 8-point DCT-II basis: BASIS[u * 8 + x].
const BASIS = Array.from({ length: 64 }, (_, k) => {
  const u = Math.floor(k / 8);
  const x = k % 8;
  return (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
});

type Plane = { readonly width: number; readonly height: number; readonly v: Float64Array };

/** IJG quality scaling of a base table (quality 1..100). */
function scaledTable(base: ReadonlyArray<number>, quality: number): number[] {
  const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  return base.map((q) => Math.min(255, Math.max(1, Math.floor((q * scale + 50) / 100))));
}

function at(plane: Plane, x: number, y: number): number {
  const cx = Math.min(plane.width - 1, Math.max(0, x));
  const cy = Math.min(plane.height - 1, Math.max(0, y));
  return plane.v[cy * plane.width + cx] as number;
}

// 1-D transform of 8 values along a stride: forward (DCT) or inverse.
function transform8(v: Float64Array, start: number, stride: number, inverse: boolean): void {
  const input = Array.from({ length: 8 }, (_, i) => v[start + i * stride] as number);
  for (let o = 0; o < 8; o += 1) {
    let sum = 0;
    for (let i = 0; i < 8; i += 1) {
      sum += (input[i] as number) * (BASIS[inverse ? i * 8 + o : o * 8 + i] as number);
    }
    v[start + o * stride] = sum;
  }
}

function transformBlock(block: Float64Array, inverse: boolean): void {
  for (let r = 0; r < 8; r += 1) transform8(block, r * 8, 1, inverse);
  for (let c = 0; c < 8; c += 1) transform8(block, c, 8, inverse);
}

// Quantise one plane in 8 x 8 blocks, edge-replicated past its border.
function quantisePlane(plane: Plane, table: ReadonlyArray<number>): Plane {
  const out = new Float64Array(plane.v.length);
  const block = new Float64Array(64);
  for (let by = 0; by < plane.height; by += 8) {
    for (let bx = 0; bx < plane.width; bx += 8) {
      for (let k = 0; k < 64; k += 1) block[k] = at(plane, bx + (k % 8), by + (k >> 3)) - 128;
      transformBlock(block, false);
      for (let k = 0; k < 64; k += 1) {
        const q = table[k] as number;
        block[k] = Math.round((block[k] as number) / q) * q;
      }
      transformBlock(block, true);
      for (let k = 0; k < 64; k += 1) {
        const x = bx + (k % 8);
        const y = by + (k >> 3);
        if (x < plane.width && y < plane.height)
          out[y * plane.width + x] = (block[k] as number) + 128;
      }
    }
  }
  return { ...plane, v: out };
}

function halve(plane: Plane): Plane {
  const width = Math.ceil(plane.width / 2);
  const height = Math.ceil(plane.height / 2);
  const v = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum =
        at(plane, 2 * x, 2 * y) +
        at(plane, 2 * x + 1, 2 * y) +
        at(plane, 2 * x, 2 * y + 1) +
        at(plane, 2 * x + 1, 2 * y + 1);
      v[y * width + x] = sum / 4;
    }
  }
  return { width, height, v };
}

// libjpeg's "fancy" h2v2 upsampling: 9/16 nearest, 3/16 each side, 1/16 corner.
function double(plane: Plane, width: number, height: number): Plane {
  const v = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const cy = y >> 1;
    const ny = cy + (y % 2 === 0 ? -1 : 1);
    for (let x = 0; x < width; x += 1) {
      const cx = x >> 1;
      const nx = cx + (x % 2 === 0 ? -1 : 1);
      v[y * width + x] =
        (9 * at(plane, cx, cy) +
          3 * at(plane, nx, cy) +
          3 * at(plane, cx, ny) +
          at(plane, nx, ny)) /
        16;
    }
  }
  return { width, height, v };
}

function toYcc(image: RawImageData): [Plane, Plane, Plane] {
  const n = image.width * image.height;
  const planes = [0, 1, 2].map(() => new Float64Array(n));
  for (let i = 0; i < n; i += 1) {
    const r = image.data[i * 4] as number;
    const g = image.data[i * 4 + 1] as number;
    const b = image.data[i * 4 + 2] as number;
    (planes[0] as Float64Array)[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    (planes[1] as Float64Array)[i] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    (planes[2] as Float64Array)[i] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  }
  const plane = (v: Float64Array): Plane => ({ width: image.width, height: image.height, v });
  return [
    plane(planes[0] as Float64Array),
    plane(planes[1] as Float64Array),
    plane(planes[2] as Float64Array),
  ];
}

/** Encode and decode as a baseline 4:2:0 JPEG at an IJG quality (1..100). */
export function jpegRoundTrip(image: RawImageData, quality: number): RawImageData {
  const { width, height } = image;
  const [y, cb, cr] = toYcc(image);
  const luma = quantisePlane(y, scaledTable(LUMA_TABLE, quality));
  const chroma = scaledTable(CHROMA_TABLE, quality);
  const blue = double(quantisePlane(halve(cb), chroma), width, height);
  const red = double(quantisePlane(halve(cr), chroma), width, height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const l = luma.v[i] as number;
    const db = (blue.v[i] as number) - 128;
    const dr = (red.v[i] as number) - 128;
    data[i * 4] = Math.round(l + 1.402 * dr);
    data[i * 4 + 1] = Math.round(l - 0.344136 * db - 0.714136 * dr);
    data[i * 4 + 2] = Math.round(l + 1.772 * db);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Separable Gaussian blur of each colour channel, edges clamped. */
export function gaussianBlur(image: RawImageData, sigma: number): RawImageData {
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, k) =>
    Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)),
  );
  const total = kernel.reduce((sum, w) => sum + w, 0);
  let data = new Float64Array(image.data);
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ] as const) {
    const next = new Float64Array(data.length);
    for (let i = 0; i < image.width * image.height; i += 1) {
      const x = i % image.width;
      const y = (i - x) / image.width;
      for (let c = 0; c < 4; c += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sx = Math.min(image.width - 1, Math.max(0, x + k * dx));
          const sy = Math.min(image.height - 1, Math.max(0, y + k * dy));
          sum += (kernel[k + radius] as number) * (data[(sy * image.width + sx) * 4 + c] as number);
        }
        next[i * 4 + c] = sum / total;
      }
    }
    data = next;
  }
  return {
    width: image.width,
    height: image.height,
    data: Uint8ClampedArray.from(data, Math.round),
  };
}

/** Gaussian grain of a given sigma, the same draw on R, G and B (seeded). */
export function withGrain(image: RawImageData, sigma: number, seed = 7): RawImageData {
  let state = seed >>> 0;
  const uniform = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < image.width * image.height; i += 1) {
    const d = sigma * Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    for (let c = 0; c < 3; c += 1) data[i * 4 + c] = Math.round((data[i * 4 + c] as number) + d);
  }
  return { ...image, data };
}
