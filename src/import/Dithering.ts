/**
 * Dithering algorithms for converting grayscale images to
 * 1-bit patterns suitable for laser engraving.
 *
 * Input:  Uint8Array of grayscale pixels (0=black, 255=white)
 * Output: Uint8Array of 1-bit values (0=no burn, 255=burn)
 */

export type DitherMode =
  | 'none'
  | 'threshold'
  | 'floyd-steinberg'
  | 'jarvis'
  | 'stucki'
  | 'ordered'
  | 'atkinson'
  | 'burkes'
  | 'sierra3'
  | 'sierra2'
  | 'sierra-lite'
  | 'blue-noise'
  | 'random';

export function getDitherModes(): { id: DitherMode; name: string }[] {
  return [
    { id: 'none', name: 'None' },
    { id: 'threshold', name: 'Threshold' },
    { id: 'floyd-steinberg', name: 'Floyd-Steinberg' },
    { id: 'jarvis', name: 'Jarvis' },
    { id: 'stucki', name: 'Stucki' },
    { id: 'ordered', name: 'Ordered' },
    { id: 'atkinson', name: 'Atkinson' },
    { id: 'burkes', name: 'Burkes' },
    { id: 'sierra3', name: 'Sierra 3' },
    { id: 'sierra2', name: 'Sierra 2' },
    { id: 'sierra-lite', name: 'Sierra Lite' },
    { id: 'blue-noise', name: 'Blue Noise' },
    { id: 'random', name: 'Random' },
  ];
}

export function ditherImage(
  data: Uint8Array,
  width: number,
  height: number,
  mode: DitherMode,
  threshold: number = 128
): Uint8Array {
  switch (mode) {
    case 'none': return data.slice(); // Return copy unchanged
    case 'threshold': return ditherThreshold(data, width, height, threshold);
    case 'floyd-steinberg': return ditherErrorDiffusion(data, width, height, threshold, FLOYD_STEINBERG);
    case 'jarvis': return ditherErrorDiffusion(data, width, height, threshold, JARVIS);
    case 'stucki': return ditherErrorDiffusion(data, width, height, threshold, STUCKI);
    case 'atkinson': return ditherErrorDiffusion(data, width, height, threshold, ATKINSON);
    case 'burkes': return ditherErrorDiffusion(data, width, height, threshold, BURKES);
    case 'sierra3': return ditherErrorDiffusion(data, width, height, threshold, SIERRA3);
    case 'sierra2': return ditherErrorDiffusion(data, width, height, threshold, SIERRA2);
    case 'sierra-lite': return ditherErrorDiffusion(data, width, height, threshold, SIERRA_LITE);
    case 'blue-noise': return ditherBlueNoise(data, width, height);
    case 'random': return ditherRandom(data, width, height);
    case 'ordered': return ditherOrdered(data, width, height);
    default: return data.slice();
  }
}

// ─── THRESHOLD ───────────────────────────────────────────────────

function ditherThreshold(
  data: Uint8Array, width: number, height: number, threshold: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] < threshold ? 255 : 0;
  }
  return out;
}

// ─── ERROR DIFFUSION ─────────────────────────────────────────────

interface DiffusionKernel {
  offsets: [number, number, number][]; // [dx, dy, weight]
  divisor: number;
}

const FLOYD_STEINBERG: DiffusionKernel = {
  offsets: [
    [1, 0, 7],
    [-1, 1, 3],
    [0, 1, 5],
    [1, 1, 1],
  ],
  divisor: 16,
};

const JARVIS: DiffusionKernel = {
  offsets: [
    [1, 0, 7], [2, 0, 5],
    [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
    [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
  ],
  divisor: 48,
};

const STUCKI: DiffusionKernel = {
  offsets: [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
    [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
  ],
  divisor: 42,
};

const ATKINSON: DiffusionKernel = {
  offsets: [
    [1, 0, 1], [2, 0, 1],
    [-1, 1, 1], [0, 1, 1], [1, 1, 1],
    [0, 2, 1],
  ],
  divisor: 8,
};

const BURKES: DiffusionKernel = {
  offsets: [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
  ],
  divisor: 32,
};

const SIERRA3: DiffusionKernel = {
  offsets: [
    [1, 0, 5], [2, 0, 3],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
    [-1, 2, 2], [0, 2, 3], [1, 2, 2],
  ],
  divisor: 32,
};

const SIERRA2: DiffusionKernel = {
  offsets: [
    [1, 0, 4], [2, 0, 3],
    [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1],
  ],
  divisor: 16,
};

const SIERRA_LITE: DiffusionKernel = {
  offsets: [
    [1, 0, 2],
    [-1, 1, 1], [0, 1, 1],
  ],
  divisor: 4,
};

function ditherErrorDiffusion(
  data: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  kernel: DiffusionKernel
): Uint8Array {
  // Work on float copy to accumulate error
  const buf = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) buf[i] = data[i];

  const out = new Uint8Array(width * height);

  // T1-34: serpentine scanning. Even rows scan left→right and propagate
  // error rightward (kernel as defined). Odd rows scan right→left and
  // propagate leftward (kernel.dx mirrored). Breaks the directional
  // coherence that produces the diagonal "worm" patterns visible on
  // mid-tone gradients pre-T1-34, especially on bidirectional engraves
  // where the always-LTR dither and alternating burn-direction compound
  // each other's artifacts. Kernel definitions are unchanged; only the
  // scan order and kernel-dx sign flip per row.
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1;
    const xStart = reverse ? width - 1 : 0;
    const xEnd = reverse ? -1 : width;
    const xStep = reverse ? -1 : 1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const i = y * width + x;
      const oldVal = buf[i];
      const newVal = oldVal < threshold ? 0 : 255;
      out[i] = newVal === 0 ? 255 : 0; // Invert: dark pixel = burn (255)
      const error = oldVal - newVal;

      // Distribute error to neighbors. On reverse rows we mirror dx so
      // the error still flows in the same direction RELATIVE to the
      // scan (i.e. ahead of the cursor + downward), not in the same
      // absolute direction.
      for (const [dx, dy, weight] of kernel.offsets) {
        const effectiveDx = reverse ? -dx : dx;
        const nx = x + effectiveDx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          buf[ny * width + nx] += (error * weight) / kernel.divisor;
        }
      }
    }
  }

  return out;
}

// ─── ORDERED (BAYER MATRIX) ──────────────────────────────────────

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function ditherOrdered(
  data: Uint8Array, width: number, height: number
): Uint8Array {
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const bayerVal = BAYER_4X4[y % 4][x % 4];
      const thresh = ((bayerVal + 0.5) / 16) * 255;
      out[i] = data[i] < thresh ? 255 : 0; // dark = burn
    }
  }

  return out;
}

// ─── BLUE NOISE ─────────────────────────────────────────────────────────────

export const BLUE_NOISE_TILE_SIZE = 16;
let blueNoiseThresholdTile: Uint8Array | null = null;

function toroidalDistanceSq(a: number, b: number, size: number): number {
  const ax = a % size;
  const ay = Math.floor(a / size);
  const bx = b % size;
  const by = Math.floor(b / size);
  const dxRaw = Math.abs(ax - bx);
  const dyRaw = Math.abs(ay - by);
  const dx = Math.min(dxRaw, size - dxRaw);
  const dy = Math.min(dyRaw, size - dyRaw);
  return dx * dx + dy * dy;
}

function tieBreakHash(index: number): number {
  let n = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35);
  return (n ^ (n >>> 16)) >>> 0;
}

export function buildBlueNoiseThresholdTile(size: number = BLUE_NOISE_TILE_SIZE): Uint8Array {
  const tileSize = Math.max(2, Math.floor(size));
  const cellCount = tileSize * tileSize;
  const ranks = new Uint16Array(cellCount);
  const occupied = new Uint8Array(cellCount);
  const placed: number[] = [];

  for (let rank = 0; rank < cellCount; rank++) {
    let bestIndex = -1;
    let bestDistance = -1;
    let bestTie = -1;

    for (let index = 0; index < cellCount; index++) {
      if (occupied[index]) continue;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const filled of placed) {
        const distance = toroidalDistanceSq(index, filled, tileSize);
        if (distance < nearestDistance) nearestDistance = distance;
      }
      const candidateDistance = placed.length === 0 ? Number.POSITIVE_INFINITY : nearestDistance;
      const tie = tieBreakHash(index);
      if (candidateDistance > bestDistance || (candidateDistance === bestDistance && tie > bestTie)) {
        bestIndex = index;
        bestDistance = candidateDistance;
        bestTie = tie;
      }
    }

    occupied[bestIndex] = 1;
    placed.push(bestIndex);
    ranks[bestIndex] = rank;
  }

  const thresholds = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    thresholds[i] = Math.max(1, Math.min(255, Math.floor(((cellCount - ranks[i]) / cellCount) * 256)));
  }
  return thresholds;
}

function getBlueNoiseThresholdTile(): Uint8Array {
  if (!blueNoiseThresholdTile) {
    blueNoiseThresholdTile = buildBlueNoiseThresholdTile();
  }
  return blueNoiseThresholdTile;
}

function ditherBlueNoise(
  data: Uint8Array, width: number, height: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  const tile = getBlueNoiseThresholdTile();
  const size = BLUE_NOISE_TILE_SIZE;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const threshold = tile[(y % size) * size + (x % size)];
      out[i] = data[i] < threshold ? 255 : 0; // dark = burn
    }
  }

  return out;
}

function ditherRandom(
  data: Uint8Array, width: number, height: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  let seed = 42;

  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const randomThreshold = seed / 0x7fffffff * 255;
    out[i] = data[i] < randomThreshold ? 255 : 0; // dark = burn
  }

  return out;
}
