// canvas-theme — the named Canvas2D palette (ADR-047).
//
// Draw modules render with raw ctx fill/stroke values; CSS custom properties
// can't reach them, so the canvas palette resolves raw paints here. Bed,
// rulers and drawing ink follow the operating-system theme (ADR-049 amendment).
// Artwork display contrast is handled separately from stored artwork colours;
// material, image pixels and output/toolpath semantics stay independent.
//
// The two values genuinely shared with the chrome (selection ↔ --lf-accent,
// out-of-bounds ↔ --lf-danger) are pinned against tokens.css by
// theme-sync.test.ts so the frames cannot drift apart silently.

import { getCanvasColorScheme } from './canvas-color-scheme';

export const DARK_CANVAS_BED = '#26231f';

function themed(light: string, dark: string): string {
  return getCanvasColorScheme() === 'dark' ? dark : light;
}

export const canvasTheme = {
  // Used as a DOM background only, so the off-bed surround can follow CSS.
  viewportSurround: 'var(--lf-bg-canvas)',
  // Bed + grid (draw-scene)
  get bedFill() {
    return themed('#ffffff', DARK_CANVAS_BED);
  },
  get bedStroke() {
    return themed('#aaa59d', '#7b7468');
  },
  get grid() {
    return themed('#ddd9d3', '#3a352d');
  },
  get artworkInk() {
    return themed('#1a1a1a', '#ece7df');
  },
  origin: '#cc0000',
  // Selection chrome (draw-scene)
  selection: '#3175d0',
  selectionHandleFill: '#ffffff',
  pathNodeHandleFill: '#ffffff',
  pathNodeHandleStroke: '#00a884',
  pathNodeHandleActiveFill: '#00a884',
  pathNodeHandleActiveStroke: '#ffffff',
  selectionMarqueeFill: 'rgba(49, 117, 208, 0.12)',
  rotateHandleStroke: '#fff',
  snapGuide: '#00a884',
  get measureStroke() {
    return themed('#7b1fa2', '#d6a5f5');
  },
  outOfBounds: '#b43337',
  openFillContour: '#f57c00',
  cncTabHandleFill: '#f7c948',
  cncTabHandleStroke: '#5b4512',
  noGoZoneFill: 'rgba(180, 51, 55, 0.12)',
  // CNC stock footprint (draw-stock, H.2) — wood-toned so it reads as
  // material, not chrome.
  stockFill: 'rgba(193, 154, 107, 0.12)',
  stockStroke: 'rgba(160, 120, 70, 0.55)',
  // Rulers (draw-rulers)
  get rulerBackground() {
    return themed('#f1efec', '#2e2b27');
  },
  get rulerBorder() {
    return themed('#ddd9d3', '#464139');
  },
  get rulerText() {
    return themed('#6b655c', '#b3aca1');
  },
  get rulerMajorTick() {
    return themed('#6b655c', '#b3aca1');
  },
  get rulerMinorTick() {
    return themed('#aaa59d', '#7b7468');
  },
  // Preview toolpath (draw-preview)
  previewTravel: '#bbbbbb',
  previewFeedTravel: '#7c5ce7',
  previewCut: '#2563eb',
  previewHeadFill: '#ff3b30',
  previewHeadStroke: '#fff',
  // Large-scene simplification notice (draw-vector-strokes)
  noticeFill: 'rgba(255, 248, 225, 0.95)',
  noticeStroke: '#d6a100',
  noticeText: '#5f4200',
  // Trace-source backing tint (draw-raster, ADR-026)
  traceSourceTint: '#3b82c4',
  // Design Studio sketch geometry (design-canvas-draw, ADR-272). Sketch
  // entities have no layer yet — they only acquire one at Apply — so they need
  // their own theme-aware ink. Construction guides remain muted.
  get designGeometry() {
    return themed('#1a1a1a', '#ece7df');
  },
  get designConstruction() {
    return themed('#9a948b', '#b3aca1');
  },
  // Off-bed surround in the Design Studio. Deliberately a clear grey rather than
  // the main viewport: the Studio surround and bed are painted side by side,
  // so a clear boundary makes drawing off the sheet immediately visible.
  get designSurround() {
    return themed('#e0ddd7', '#1c1a18');
  },
  // Live-motion label (draw-canvas-motion). Both follow the bed: a hard-white
  // plate on the dark bed read as a sticker pasted over the work, and the
  // safety red that carries it needs lifting to stay legible on the dark plate.
  get motionLabelPlate() {
    return themed('#ffffff', '#141210');
  },
  get motionLabelInk() {
    return themed('#dc2626', '#fca5a5');
  },
  // Live burn progress (draw-canvas-motion-route, draw-burn-trail).
  //
  // The completed trail used one saturated red at a fixed device width, so a
  // dense hatch fill — whose lines sit well under a pixel apart at working
  // zoom — overlapped into a solid mass that hid the artwork underneath. The
  // trail now paints opaque into its raster and composites ONCE at a capped
  // alpha, so overlapping burns settle at a single uniform scorch instead of
  // accumulating, and the artwork still reads through a fully covered region.
  //
  // Warm amber rather than red: red stays reserved for the safety chrome
  // (frame/job markers, approach, head ring), so scorch never reads as a
  // machine-state warning.
  get burnScorch() {
    return themed('#c2410c', '#fb923c');
  },
  // Rapids are not work, so they recede instead of competing with the burn.
  get burnTravel() {
    return themed('#9a948b', '#7b7468');
  },
  get burnPlanned() {
    // Slate at 0.28 was invisible against the dark bed, and both values are
    // pre-divided by the composite alpha so they land where they are specified.
    return themed('rgba(90, 84, 76, 0.42)', 'rgba(179, 172, 161, 0.40)');
  },
} as const;

/**
 * Cooling ramp for the ember tail behind the live head, coldest first. The last
 * entry is the white-hot core at the beam itself; on the light bed the hot end
 * stays a saturated gold, since near-white would vanish against paper.
 *
 * A sibling export rather than a `canvasTheme` member so every value on that
 * object stays a single colour string.
 */
export function burnEmberRamp(): ReadonlyArray<string> {
  return getCanvasColorScheme() === 'dark'
    ? ['#7c2d12', '#b45309', '#ea580c', '#fb923c', '#fbbf24', '#fef3c7']
    : ['#9a3412', '#c2410c', '#ea580c', '#f97316', '#fbbf24', '#fcd34d'];
}
