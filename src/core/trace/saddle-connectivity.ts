// Saddle connectivity — the one decision every binary-mask stage must agree
// on: where two ink pixels touch ONLY at a corner (a 2×2 "saddle" block with
// ink on one diagonal and paper on the other), is the ink joined through that
// corner, or is the paper?
//
// A binary mask cannot answer this by itself; it is the classic digital-
// topology ambiguity (Rosenfeld: ink and paper cannot both be 8-connected).
// The boundary walker, the ink despeckle and the paper pinhole fill must all
// use the SAME answer at every corner, or a shape the walker traces as one
// piece is despeckled pixel by pixel (the 1-px diagonal hairline defect).
//
// Policies (TraceOptions.turnPolicy):
//   'connect-paper' — paper always wins: ink is 4-connected. The historical
//                     rule (the walker's fixed right turn).
//   'connect-ink'   — ink always wins: ink is 8-connected.
//   'auto'          — decide each saddle from local evidence:
//     1. Structure first: a local minority rule over the 4×4 window centred
//        on the corner (the 2×2 block plus its one-pixel ring). The block is
//        always 2 ink / 2 paper, so the ring decides: the colour that is the
//        MINORITY in the window is the thin one and keeps its diagonal
//        connection. Pixels beyond the image border are not counted.
//     2. A window tie (two equal shapes kissing at a corner, a checkerboard)
//        is structurally symmetric. Where the pre-threshold crack field shows
//        a genuine anti-aliasing ramp in the 2×2 block (not saturated, and
//        still agreeing with the mask), the asymptotic decider of Nielson &
//        Hamann (1991) settles it: evaluate the bilinear interpolant of the
//        four threshold residuals at its saddle point; ink joins iff that
//        value lies on the ink side of the cut. Otherwise paper joins (the
//        historical answer).
//   The window outranks the decider on purpose. Bilinear reconstruction
//   systematically under-reads ridges: on a one-pixel anti-aliased diagonal
//   (core 24, flanks 195) the true box-filtered value at the shared corner
//   equals the core, but the bilinear saddle is the midpoint ≈110 — so at a
//   low cut (Otsu picked 25 beside a solid square) the decider alone
//   shattered the line into 56 islands. A decided thin feature is kept;
//   grey evidence decides only what the structure cannot.
//
// Written from the papers' mathematics and our own design (ADR-395); no
// third-party tracer code.

import type { InkMask } from './centerline/distance-field';

/** Pre-threshold grayscale access for sub-pixel crack interpolation and
 *  saddle decisions. Luma is in the SAME (gamma-encoded) space the threshold
 *  cut is defined in — the iso-line must match the space of the cut, so no
 *  linearization here. The threshold is a per-position function because the
 *  sketch (local-contrast) binarization cuts at luma = localMean − bias, not
 *  at a global constant. */
export type CrackSubPixelField = {
  /** Luma at pixel (x,y); out-of-bounds must read as background (255). */
  readonly lumaAt: (x: number, y: number) => number;
  /** Ink is luma below thresholdAt(x,y) at that position. */
  readonly thresholdAt: (x: number, y: number) => number;
};

// A saturated luma step (paper-white against full ink) contains NO sub-pixel
// information — the true edge could be anywhere inside the step. Shared with
// crack interpolation so both measurements trust the same blocks.
export const SATURATED_BG_LUMA = 250;
export const SATURATED_INK_LUMA = 5;

export type TurnPolicy = 'auto' | 'connect-ink' | 'connect-paper';

/** Any unknown value (older project files, bad input) means the default. */
export function normalizeTurnPolicy(value: unknown): TurnPolicy {
  return value === 'connect-ink' || value === 'connect-paper' ? value : 'auto';
}

/** Decision at the lattice corner (x,y) — the point shared by pixels
 *  (x−1,y−1), (x,y−1), (x−1,y), (x,y). true: the two diagonal INK pixels are
 *  joined through the corner (and the paper pair is split); false: the
 *  paper pair is joined. Only consulted at saddle corners. */
export type SaddleResolver = (cornerX: number, cornerY: number) => boolean;

/** The historical fixed rule, kept for callers that never opted in. */
export const CONNECT_PAPER_AT_SADDLES: SaddleResolver = () => false;
const CONNECT_INK_AT_SADDLES: SaddleResolver = () => true;

/** What a cleanup stage needs to rebuild the walker's resolver on its own
 *  intermediate mask. */
export type SaddlePolicyInput = {
  readonly turnPolicy: TurnPolicy;
  readonly field?: CrackSubPixelField | null;
};

// 4×4 window: pixels corner−2 … corner+1 on each axis.
const WINDOW_LOW = -2;
const WINDOW_HIGH = 1;

/** The policy the binary cleanup stages share with the contour walker.
 *  Centerline thins eight-connected ink and keeps its own convention. */
export function cleanupSaddlePolicy(
  options: { readonly traceMode?: string; readonly turnPolicy?: unknown },
  field: CrackSubPixelField | null,
): SaddlePolicyInput | undefined {
  if (options.traceMode === 'centerline') return undefined;
  return { turnPolicy: normalizeTurnPolicy(options.turnPolicy), field };
}

export function createSaddleResolver(
  mask: InkMask,
  policy: TurnPolicy,
  field?: CrackSubPixelField | null,
): SaddleResolver {
  if (policy === 'connect-ink') return CONNECT_INK_AT_SADDLES;
  if (policy === 'connect-paper') return CONNECT_PAPER_AT_SADDLES;
  return (x, y) => {
    const balance = windowInkBalance(mask, x, y);
    if (balance !== 0) return balance < 0;
    const grey = field === undefined || field === null ? null : greySaddle(mask, field, x, y);
    return grey ?? false;
  };
}

/** True when the 2×2 block at corner (x,y) is a saddle of the mask. */
export function isSaddle(mask: InkMask, x: number, y: number): boolean {
  const a = inkAt(mask, x - 1, y - 1);
  const d = inkAt(mask, x, y);
  return a === d && inkAt(mask, x, y - 1) === inkAt(mask, x - 1, y) && a !== inkAt(mask, x, y - 1);
}

/** Ink minus paper over the in-image part of the 4×4 window: negative means
 *  ink is the local minority. Pixels beyond the border are NOT counted —
 *  the walker's out-of-image paper convention would otherwise make every
 *  shape look thin near an edge. */
function windowInkBalance(mask: InkMask, x: number, y: number): number {
  let balance = 0;
  for (
    let py = Math.max(0, y + WINDOW_LOW);
    py <= Math.min(mask.height - 1, y + WINDOW_HIGH);
    py += 1
  ) {
    for (
      let px = Math.max(0, x + WINDOW_LOW);
      px <= Math.min(mask.width - 1, x + WINDOW_HIGH);
      px += 1
    ) {
      balance += inkAt(mask, px, py) === 1 ? 1 : -1;
    }
  }
  return balance;
}

type Corner = { readonly x: number; readonly y: number };
const BLOCK: ReadonlyArray<Corner> = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 0 },
];

/** Asymptotic decider on the threshold residual r = luma − threshold (ink
 *  where r < 0). With the block's residuals r00, r10, r01, r11 at the four
 *  pixel centres, the bilinear interpolant's saddle value is
 *      (r00·r11 − r10·r01) / (r00 + r11 − r10 − r01).
 *  Its sign says which diagonal the continuous iso-line keeps connected.
 *  Returns null when the field carries no information for this block. */
function greySaddle(
  mask: InkMask,
  field: CrackSubPixelField,
  x: number,
  y: number,
): boolean | null {
  const residual: number[] = [];
  let saturated = true;
  for (const offset of BLOCK) {
    const px = x + offset.x;
    const py = y + offset.y;
    const luma = field.lumaAt(px, py);
    const r = luma - field.thresholdAt(px, py);
    const ink = inkAt(mask, px, py) === 1;
    // Cleanup stages flip mask pixels without touching luma; a block the
    // field no longer describes is decided on the mask alone.
    if (!Number.isFinite(r) || r < 0 !== ink) return null;
    if (ink ? luma > SATURATED_INK_LUMA : luma < SATURATED_BG_LUMA) saturated = false;
    residual.push(r);
  }
  if (saturated) return null;
  const [r00 = 0, r10 = 0, r01 = 0, r11 = 0] = residual;
  const denominator = r00 + r11 - r10 - r01;
  // Nonzero at a genuine saddle (ink residuals < 0 ≤ paper residuals).
  if (denominator === 0) return null;
  return (r00 * r11 - r10 * r01) / denominator < 0;
}

function inkAt(mask: InkMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return (mask.ink[y * mask.width + x] ?? 0) === 0 ? 0 : 1;
}
