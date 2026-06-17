// canvas-theme — the named Canvas2D palette (ADR-047).
//
// Draw modules render with raw ctx fill/stroke values; CSS custom properties
// can't reach them, so the canvas palette lives here as TS constants. Values
// are byte-identical to the literals they replace — the workspace viewport
// (light bed on a light surround) deliberately KEEPS its current look while
// the chrome around it goes dark; WYSIWYG against white material wins.
//
// The two values genuinely shared with the chrome (selection ↔ --lf-accent,
// out-of-bounds ↔ --lf-danger) are pinned against tokens.css by
// theme-sync.test.ts so the frames cannot drift apart silently.

export const canvasTheme = {
  // The DOM surface AROUND the bed (Workspace canvas area) — part of the
  // deliberately-light viewport, not the dark chrome.
  viewportSurround: '#fafafa',
  // Bed + grid (draw-scene)
  bedFill: '#ffffff',
  bedStroke: '#888888',
  grid: '#d8d8d8',
  origin: '#cc0000',
  // Selection chrome (draw-scene)
  selection: '#1976d2',
  selectionHandleFill: '#ffffff',
  rotateHandleStroke: '#fff',
  outOfBounds: '#c62828',
  noGoZoneFill: 'rgba(198, 40, 40, 0.12)',
  // Rulers (draw-rulers)
  rulerBackground: '#f0f0f0',
  rulerBorder: '#bbb',
  rulerText: '#666',
  rulerMajorTick: '#666',
  rulerMinorTick: '#aaa',
  // Preview toolpath (draw-preview)
  previewTravel: '#bbbbbb',
  previewHeadFill: '#ff3b30',
  previewHeadStroke: '#fff',
  // Large-scene simplification notice (draw-vector-strokes)
  noticeFill: 'rgba(255, 248, 225, 0.95)',
  noticeStroke: '#d6a100',
  noticeText: '#5f4200',
  // Trace-source backing tint (draw-raster, ADR-026)
  traceSourceTint: '#3b82c4',
} as const;
