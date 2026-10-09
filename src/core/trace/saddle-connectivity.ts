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
//     1. Structure first: a local minority rule over the window centred on
//        the corner — 4×4 SOURCE pixels (the 2×2 block plus its one-pixel
//        ring), i.e. 4s×4s mask pixels on a trace supersampled by s. The
//        block is always half ink, so the ring decides: the colour that is
//        the MINORITY in the window is the thin one and keeps its diagonal
//        connection. The window must be measured in source pixels: at 2x a
//        4×4 mask window is just the enlarged 2×2 block, where a hairline and
//        a checkerboard look identical. Near the image border each axis of
//        the window shrinks symmetrically to what still fits (never counting
//        the walker's out-of-image paper, which would make every shape look
//        thin at an edge). A window centred on a checkerboard corner ties,
//        and so does the one blind spot: a corner diagonally next to an
//        image corner, where only its own 2×2 block fits.
//     2. A 4×4 tie (two equal shapes kissing at a corner, a checkerboard) is
//        structurally symmetric. Where the pre-threshold crack field shows
//        a genuine anti-aliasing ramp in the 2×2 block (not saturated, and
//        still agreeing with the mask), the asymptotic decider of Nielson &
//        Hamann (1991) settles it: evaluate the bilinear interpolant of the
//        four threshold residuals at its saddle point; ink joins iff that
//        value lies on the ink side of the cut by more than
//        GREY_SADDLE_MARGIN_LUMA. The margin matters: a SYMMETRIC saddle's
//        bilinear value is just the block mean, so a fine checkerboard (or
//        a bilinear enlargement of a binary one, which is how small sources
//        reach the 2x trace) sits within a luma level of a mid cut (127.5
//        against 128) and its sign is noise, not evidence.
//     3. With no grey evidence (a binary source, a saturated block), the
//        vote widens to the 6×6 and then the 8×8 window (ADR-403 amendment
//        1), each centred on the corner and shrunk at the border the same
//        way. A wider window counts only the ring it adds, and that ring
//        decides only when at least 7/8 of it is one colour: two marks
//        kissing on a page join, but the rim of a checkerboard patch (cells
//        one side, page the other) stays a tie. A checkerboard ties at
//        every size, border included, with one exception: in a small patch
//        (4-6 px across) the 4×4 window is the balanced patch itself and
//        the wider rings are page, so its central corners join ink, as the
//        minority rule intends for a tiny dither cluster. Grey evidence goes
//        before the wider rings because it is measured at the corner itself:
//        on the photo ties both could settle it disagreed with the ring 13-42%
//        of the time, and putting it first held or improved every fixture.
//     4. Otherwise paper joins (the historical answer).
//   The 4×4 window outranks the decider on purpose. Bilinear reconstruction
//   systematically under-reads ridges: on a one-pixel anti-aliased diagonal
//   (core 24, flanks 195) the true box-filtered value at the shared corner
//   equals the core, but the bilinear saddle is the midpoint ≈110 — so at a
//   low cut (Otsu picked 25 beside a solid square) the decider alone
//   shattered the line into 56 islands. A decided thin feature is kept;
//   grey evidence decides only what the 4×4 structure cannot.
//
// Written from the papers' mathematics and our own design (ADR-403); no
// third-party tracer code.

import type { InkMask } from './centerline/distance-field';
import type { TraceOptions } from './trace-option-types';

/** Pre-threshold grayscale access for sub-pixel crack interpolation and
 *  saddle decisions. Luma is in the SAME (gamma-encoded) space the threshold
 *  cut is defined in — the iso-line must match the space of the cut, so no
 *  linearization here. The threshold is a per-position function because the
 *  sketch (local-contrast) binarization cuts at luma = localMean − bias, not
 *  at a global constant. */
export type CrackSubPixelField = {
  /** Luma at pixel (x,y); out-of-bounds must read as background (255). */
  readonly lumaAt: (x: number, y: number) => number;
  /** Ink is luma below thresholdAt(x,y) at that position; luma exactly at
   *  the cut may be either class (the brightness band's cut is inclusive,
   *  the global and sketch cuts are strict), so consumers accept both. */
  readonly thresholdAt: (x: number, y: number) => number;
  /** Optional edge placement for the contour walker only: the crossing t
   *  (0 = paper pixel centre, 1 = ink pixel centre) of the crack between
   *  ink pixel (inkX,inkY) and paper pixel (bgX,bgY), or undefined for the
   *  interpolation against thresholdAt. Saddle decisions and cleanup never
   *  read it, so it moves vertices without touching topology (ADR-533). */
  readonly crackCrossingAt?: (
    inkX: number,
    inkY: number,
    bgX: number,
    bgY: number,
  ) => number | undefined;
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
 *  intermediate mask. pixelScale: supersampling factor of the mask
 *  (TraceOptions.pixelScale), which sizes the window in source pixels. */
export type SaddlePolicyInput = {
  readonly turnPolicy: TurnPolicy;
  readonly field?: CrackSubPixelField | null;
  readonly pixelScale?: number;
};

// Vote window half-sizes in SOURCE pixels, tried in order: the corner's 2×2
// block plus a one-pixel ring is 4×4 (two pixels either side of the
// corner); a tie there that grey evidence cannot settle widens to 6×6 and
// then 8×8 (ADR-403 amendment 1).
// The 2×2 block alone is always balanced, so the vote starts at 4×4.
const VOTE_RADII_SOURCE_PX: ReadonlyArray<number> = [2, 3, 4];
// A widened ring decides only when |ink − paper| over it is at least 3/4 of
// its area, i.e. at least 7/8 of the ring is one colour (4·|b| ≥ 3·area).
// Measured (ADR-403 amendment 1): looser tests (any unbalanced window, or a
// whole window 3/4 one colour) welded the rim of a 2-px checkerboard patch
// on a page (topology.clean outers 40 → 17, truth 40); isolated marks and
// pinholes have a uniform ring and still decide.
const RING_DECISIVE_QUARTERS = 3;
// A grey tie is only settled when the bilinear saddle value clears the cut
// by more than this many luma levels. Any binary pattern that is symmetric
// about the corner (a checkerboard, or its bilinear enlargement on the 2x
// path) reads exactly the block mean, 127.5, so its value is ±0.5 at a mid
// cut plus 8-bit rounding. Kept that small on purpose: real anti-aliased
// ties a few levels off the cut are evidence (a margin of 8 dropped measured
// Arch House detail that the 2x support restore then had to put back).
const GREY_SADDLE_MARGIN_LUMA = 2;

/** The policy the binary cleanup stages share with the contour walker.
 *  Centerline thins eight-connected ink and keeps its own convention. */
export function cleanupSaddlePolicy(
  options: Pick<TraceOptions, 'traceMode' | 'turnPolicy' | 'pixelScale'>,
  field: CrackSubPixelField | null,
): SaddlePolicyInput | undefined {
  if (options.traceMode === 'centerline') return undefined;
  return {
    turnPolicy: normalizeTurnPolicy(options.turnPolicy),
    field,
    ...(options.pixelScale === undefined ? {} : { pixelScale: options.pixelScale }),
  };
}

export function createSaddleResolver(
  mask: InkMask,
  policy: TurnPolicy,
  field?: CrackSubPixelField | null,
  pixelScale = 1,
): SaddleResolver {
  if (policy === 'connect-ink') return CONNECT_INK_AT_SADDLES;
  if (policy === 'connect-paper') return CONNECT_PAPER_AT_SADDLES;
  const scale = Number.isFinite(pixelScale) ? Math.max(1, Math.round(pixelScale)) : 1;
  const radii = VOTE_RADII_SOURCE_PX.map((radius) => radius * scale);
  return (x, y) => {
    const local = minorityVote(mask, x, y, radii, 0, 1);
    if (local !== 0) return local < 0;
    const grey = field === undefined || field === null ? null : greySaddle(mask, field, x, y);
    if (grey !== null) return grey;
    return minorityVote(mask, x, y, radii, 1, radii.length) < 0;
  };
}

/** Signed minority evidence at corner (x,y) from the windows radii[from]
 *  up to, not including, radii[to]; 0 when none decides. Negative means
 *  ink is the local minority. The first window (4×4 source px) decides
 *  whenever it is unbalanced. Each wider window counts only the RING it
 *  adds to the window before it (radii[from − 1], clamped alike), and
 *  that ring decides only when at least 7/8 of it is one colour
 *  (4·|ring balance| ≥ 3·ring area): isolated marks on a page or pinholes
 *  in solid ink have a near-uniform ring, while the rim of a checkerboard
 *  patch (cells on one side, page on the other) has a mixed ring and stays
 *  a tie. Near the border each axis's half-size shrinks to what fits inside
 *  the image on both sides, so every window stays centred on the corner:
 *  mirror-symmetric patterns (a checkerboard of any cell size) stay tied,
 *  and the walker's out-of-image paper never makes a shape look thin.
 *  Saddle corners lie strictly inside the lattice (out-of-image pixels are
 *  paper, so a border corner is never a saddle), hence each half-size is at
 *  least 1. Once the border stops both axes from growing, a wider radius
 *  would add an empty ring, so the vote ends. Each pixel is read at most
 *  once: a full tie costs at most 64 reads at scale 1 (16 + 20 + 28),
 *  times scale², and a mixed ring stops early. */
function minorityVote(
  mask: InkMask,
  x: number,
  y: number,
  radii: ReadonlyArray<number>,
  from: number,
  to: number,
): number {
  const inner = from > 0 ? (radii[from - 1] ?? 0) : 0;
  let previousRx = inner > 0 ? halfSize(inner, x, mask.width) : 0;
  let previousRy = inner > 0 ? halfSize(inner, y, mask.height) : 0;
  for (let index = from; index < to; index += 1) {
    const radius = radii[index] ?? 0;
    const rx = halfSize(radius, x, mask.width);
    const ry = halfSize(radius, y, mask.height);
    if (rx === previousRx && ry === previousRy) break;
    const ringArea = 4 * (rx * ry - previousRx * previousRy);
    // The first window decides on any imbalance; a wider ring needs
    // 4·|ring| ≥ 3·area.
    const need = previousRx === 0 ? 1 : Math.ceil((RING_DECISIVE_QUARTERS * ringArea) / 4);
    const ring = ringInkBalance(mask, x, y, rx, ry, previousRx, previousRy, need);
    if (Math.abs(ring) >= need) return ring;
    previousRx = rx;
    previousRy = ry;
  }
  return 0;
}

/** A window half-size on one axis: the radius, shrunk so the window stays
 *  centred on corner coordinate c inside [0, extent). */
function halfSize(radius: number, c: number, extent: number): number {
  return Math.max(1, Math.min(radius, c, extent - c));
}

/** Ink minus paper over the window of half-sizes (rx, ry) centred on
 *  corner (x,y), minus the inner window (irx, iry) already counted (0, 0
 *  for none), so each pixel is read once however far the vote widens.
 *  Returns 0 as soon as the rows left cannot bring |balance| up to `need`
 *  (a mixed ring, e.g. on a checkerboard, stops after a row or two). The
 *  caller keeps the window inside the image and the inner window inside
 *  it. */
function ringInkBalance(
  mask: InkMask,
  x: number,
  y: number,
  rx: number,
  ry: number,
  irx: number,
  iry: number,
  need: number,
): number {
  const { ink, width } = mask;
  let balance = 0;
  let remaining = 4 * (rx * ry - irx * iry);
  for (let py = y - ry; py < y + ry; py += 1) {
    const row = py * width;
    const skipsInner = py >= y - iry && py < y + iry;
    if (skipsInner) {
      balance += spanInkBalance(ink, row + x - rx, row + x - irx);
      balance += spanInkBalance(ink, row + x + irx, row + x + rx);
      remaining -= 2 * (rx - irx);
    } else {
      balance += spanInkBalance(ink, row + x - rx, row + x + rx);
      remaining -= 2 * rx;
    }
    if (Math.abs(balance) + remaining < need) return 0;
  }
  return balance;
}

/** Ink minus paper over mask indices [from, to). */
function spanInkBalance(ink: InkMask['ink'], from: number, to: number): number {
  let balance = 0;
  for (let i = from; i < to; i += 1) balance += (ink[i] ?? 0) === 0 ? -1 : 1;
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
 *  where r < 0; r = 0 lies on the cut and agrees with either class). With
 *  the block's residuals r00, r10, r01, r11 at the four pixel centres,
 *  the bilinear interpolant's saddle value is
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
    const sample = blockSample(mask, field, x + offset.x, y + offset.y);
    if (sample === null) return null;
    if (!sample.saturated) saturated = false;
    residual.push(sample.residual);
  }
  if (saturated) return null;
  const [r00 = 0, r10 = 0, r01 = 0, r11 = 0] = residual;
  const denominator = r00 + r11 - r10 - r01;
  // Nonzero at a genuine saddle (ink residuals ≤ 0 ≤ paper residuals, not
  // all of them on the cut).
  if (denominator === 0) return null;
  const saddleValue = (r00 * r11 - r10 * r01) / denominator;
  if (Math.abs(saddleValue) <= GREY_SADDLE_MARGIN_LUMA) return null;
  return saddleValue < 0;
}

/** One block pixel's residual, or null when the field no longer describes
 *  the mask there: cleanup stages flip mask pixels without touching luma,
 *  and such a block is decided on the mask alone. */
function blockSample(
  mask: InkMask,
  field: CrackSubPixelField,
  x: number,
  y: number,
): { readonly residual: number; readonly saturated: boolean } | null {
  const luma = field.lumaAt(x, y);
  const residual = luma - field.thresholdAt(x, y);
  if (!Number.isFinite(residual)) return null;
  const ink = inkAt(mask, x, y) === 1;
  if (ink ? residual > 0 : residual < 0) return null;
  return {
    residual,
    saturated: ink ? luma <= SATURATED_INK_LUMA : luma >= SATURATED_BG_LUMA,
  };
}

function inkAt(mask: InkMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return (mask.ink[y * mask.width + x] ?? 0) === 0 ? 0 : 1;
}
