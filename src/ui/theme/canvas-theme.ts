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

export const DARK_CANVAS_BED = '#242930';

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
    return themed('#a2afbf', '#65758b');
  },
  get grid() {
    return themed('#dce2ea', '#343b46');
  },
  get artworkInk() {
    return themed('#1a1a1a', '#e0e7f2');
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
    return themed('#f5f7fa', '#272c34');
  },
  get rulerBorder() {
    return themed('#dce2ea', '#3d4653');
  },
  get rulerText() {
    return themed('#5f6f85', '#a0afc3');
  },
  get rulerMajorTick() {
    return themed('#5f6f85', '#a0afc3');
  },
  get rulerMinorTick() {
    return themed('#a2afbf', '#65758b');
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
    return themed('#1a1a1a', '#e0e7f2');
  },
  get designConstruction() {
    return themed('#9aa0a6', '#a0afc3');
  },
  // Off-bed surround in the Design Studio. Deliberately a clear grey rather than
  // the main viewport: the Studio surround and bed are painted side by side,
  // so a clear boundary makes drawing off the sheet immediately visible.
  get designSurround() {
    return themed('#dfe3e8', '#191d23');
  },
} as const;
