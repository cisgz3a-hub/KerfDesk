import type { LibraryEntry } from './design-library-types';

const OWNED_PROVENANCE = {
  sourceKind: 'owned',
  license: 'KerfDesk first-party asset (MIT)',
  notice: 'Authored for KerfDesk/LaserForge in this repository.',
} as const;

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function path(d: string): string {
  return `<path d="${d}" fill="none" stroke="#000000" stroke-width="0.1"/>`;
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return path(`M${x1} ${y1}L${x2} ${y2}`);
}

function rect(x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000000" stroke-width="0.1"/>`;
}

function circle(cx: number, cy: number, r: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000000" stroke-width="0.1"/>`;
}

function ownedEntry(args: {
  readonly id: string;
  readonly title: string;
  readonly category: LibraryEntry['category'];
  readonly subcategory: string;
  readonly machineModes: LibraryEntry['machineModes'];
  readonly operations: LibraryEntry['operations'];
  readonly tags: ReadonlyArray<string>;
  readonly svgText: string;
}): LibraryEntry {
  return {
    id: args.id,
    title: args.title,
    category: args.category,
    subcategory: args.subcategory,
    kind: 'owned-template',
    machineModes: args.machineModes,
    operations: args.operations,
    tags: args.tags,
    provenance: OWNED_PROVENANCE,
    previewSvgText: args.svgText,
    insert: { kind: 'svg', svgText: args.svgText },
  };
}

function gridRects(
  rows: number,
  cols: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): string {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) =>
      rect(x0 + col * (w + 3), y0 + row * (h + 3), w, h),
    ).join(''),
  ).join('');
}

function circleGrid(
  rows: number,
  cols: number,
  x0: number,
  y0: number,
  spacing: number,
  radius: number,
): string {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) =>
      circle(x0 + col * spacing, y0 + row * spacing, radius),
    ).join(''),
  ).join('');
}

function crosshair(cx: number, cy: number, radius: number): string {
  return (
    circle(cx, cy, radius) +
    line(cx - radius * 1.4, cy, cx + radius * 1.4, cy) +
    line(cx, cy - radius * 1.4, cx, cy + radius * 1.4)
  );
}

function slottedStrip(width: number, height: number, slotCount: number): string {
  const gap = width / (slotCount + 1);
  return (
    rect(0, 0, width, height) +
    Array.from({ length: slotCount }, (_, idx) =>
      rect(gap * (idx + 1) - 1, height * 0.2, 2, height * 0.6),
    ).join('')
  );
}

function sixPanelLayout(width: number, height: number): string {
  return [
    rect(2, 2, width, height),
    rect(width + 6, 2, width, height),
    rect(width * 2 + 10, 2, width, height),
    rect(2, height + 6, width, height),
    rect(width + 6, height + 6, width, height),
    rect(width * 2 + 10, height + 6, width, height),
    line(2, height + 3, width * 3 + 10, height + 3),
  ].join('');
}

export const OWNED_TEMPLATE_ENTRIES: ReadonlyArray<LibraryEntry> = [
  ownedEntry({
    id: 'laser-power-speed-grid',
    title: 'Power / Speed Grid',
    category: 'Test & Calibration',
    subcategory: 'Laser tests',
    machineModes: ['laser'],
    operations: ['line', 'fill', 'calibration'],
    tags: ['laser', 'power', 'speed', 'plywood', 'test'],
    svgText: svg(80, 55, gridRects(5, 6, 5, 5, 9, 6)),
  }),
  ownedEntry({
    id: 'laser-line-interval-test',
    title: 'Line Interval / LPI Test',
    category: 'Test & Calibration',
    subcategory: 'Laser tests',
    machineModes: ['laser'],
    operations: ['line', 'calibration'],
    tags: ['laser', 'line-interval', 'lpi', 'engrave', 'test'],
    svgText: svg(
      70,
      42,
      Array.from({ length: 8 }, (_, idx) => line(5, 5 + idx * 4, 65, 5 + idx * 4)).join(''),
    ),
  }),
  ownedEntry({
    id: 'laser-kerf-comb',
    title: 'Kerf Comb',
    category: 'Test & Calibration',
    subcategory: 'Fit tests',
    machineModes: ['laser'],
    operations: ['line', 'calibration'],
    tags: ['laser', 'kerf', 'slot', 'fit', 'plywood'],
    svgText: svg(
      70,
      24,
      rect(3, 3, 64, 18) +
        Array.from({ length: 9 }, (_, idx) => line(12 + idx * 5, 3, 12 + idx * 5, 18)).join(''),
    ),
  }),
  ownedEntry({
    id: 'laser-tab-bridge-strip',
    title: 'Tab / Bridge Strip',
    category: 'Test & Calibration',
    subcategory: 'Cut tests',
    machineModes: ['laser'],
    operations: ['line', 'calibration'],
    tags: ['laser', 'tabs', 'bridges', 'cut', 'test'],
    svgText: svg(90, 18, slottedStrip(84, 12, 6)),
  }),
  ownedEntry({
    id: 'registration-mark-sheet',
    title: 'Registration Mark Sheet',
    category: 'Test & Calibration',
    subcategory: 'Registration',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'calibration'],
    tags: ['registration', 'origin', 'alignment', 'camera'],
    svgText: svg(
      90,
      60,
      crosshair(12, 12, 4) + crosshair(78, 12, 4) + crosshair(12, 48, 4) + crosshair(78, 48, 4),
    ),
  }),
  ownedEntry({
    id: 'camera-alignment-marker-sheet',
    title: 'Camera Alignment Marker Sheet',
    category: 'Test & Calibration',
    subcategory: 'Camera',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'calibration'],
    tags: ['camera', 'alignment', 'calibration', 'markers'],
    svgText: svg(
      80,
      55,
      circleGrid(3, 4, 14, 12, 17, 3) +
        Array.from({ length: 4 }, (_, col) => line(14 + col * 17, 6, 14 + col * 17, 48)).join(''),
    ),
  }),
  ownedEntry({
    id: 'sign-plaque-blank',
    title: 'Sign / Plaque Blank',
    category: 'Signs & Plaques',
    subcategory: 'Blanks',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'profile'],
    tags: ['sign', 'plaque', 'blank', 'profile'],
    svgText: svg(90, 35, rect(3, 3, 84, 29) + line(12, 17.5, 78, 17.5) + line(45, 7, 45, 28)),
  }),
  ownedEntry({
    id: 'coaster-border-blank',
    title: 'Coaster Border Blank',
    category: 'Signs & Plaques',
    subcategory: 'Blanks',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'profile'],
    tags: ['coaster', 'border', 'blank', 'profile'],
    svgText: svg(55, 55, rect(5, 5, 45, 45) + rect(9, 9, 37, 37)),
  }),
  ownedEntry({
    id: 'keychain-hole-blank',
    title: 'Keychain Blank',
    category: 'Signs & Plaques',
    subcategory: 'Blanks',
    machineModes: ['laser'],
    operations: ['line', 'profile'],
    tags: ['keychain', 'blank', 'hole', 'ornament'],
    svgText: svg(60, 25, rect(6, 5, 48, 15) + circle(13, 12.5, 2.2)),
  }),
  ownedEntry({
    id: 'ornament-hole-blank',
    title: 'Ornament Blank',
    category: 'Signs & Plaques',
    subcategory: 'Blanks',
    machineModes: ['laser'],
    operations: ['line', 'profile'],
    tags: ['ornament', 'blank', 'hole', 'seasonal'],
    svgText: svg(45, 52, circle(22.5, 29, 17) + circle(22.5, 8, 2.2) + line(22.5, 10.5, 22.5, 12)),
  }),
  ownedEntry({
    id: 'box-small-tray-preset',
    title: 'Small Tray Box Preset',
    category: 'Boxes & Joinery',
    subcategory: 'Box presets',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'profile'],
    tags: ['box', 'tray', 'finger-joint', 'joinery'],
    svgText: svg(88, 58, sixPanelLayout(24, 16)),
  }),
  ownedEntry({
    id: 'box-pencil-box-preset',
    title: 'Pencil Box Preset',
    category: 'Boxes & Joinery',
    subcategory: 'Box presets',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'profile'],
    tags: ['box', 'pencil', 'finger-joint', 'joinery'],
    svgText: svg(120, 54, sixPanelLayout(34, 14)),
  }),
  ownedEntry({
    id: 'box-electronics-box-preset',
    title: 'Electronics Box Preset',
    category: 'Boxes & Joinery',
    subcategory: 'Box presets',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'profile', 'drill'],
    tags: ['box', 'electronics', 'mounting', 'holes'],
    svgText: svg(
      100,
      65,
      sixPanelLayout(28, 18) +
        circle(12, 12, 1.5) +
        circle(82, 12, 1.5) +
        circle(12, 52, 1.5) +
        circle(82, 52, 1.5),
    ),
  }),
  ownedEntry({
    id: 'box-open-bin-preset',
    title: 'Open Bin Box Preset',
    category: 'Boxes & Joinery',
    subcategory: 'Box presets',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'profile'],
    tags: ['box', 'bin', 'open-top', 'storage'],
    svgText: svg(
      86,
      44,
      rect(4, 4, 24, 16) +
        rect(31, 4, 24, 16) +
        rect(58, 4, 24, 16) +
        rect(18, 24, 24, 16) +
        rect(45, 24, 24, 16),
    ),
  }),
  ownedEntry({
    id: 'cnc-profile-fit-test',
    title: 'CNC Profile Fit Test',
    category: 'CNC Templates',
    subcategory: 'Fit tests',
    machineModes: ['cnc'],
    operations: ['profile'],
    tags: ['cnc', 'profile', 'fit', 'router'],
    svgText: svg(
      70,
      45,
      rect(5, 5, 60, 35) +
        rect(14, 12, 18, 16) +
        rect(38, 12, 18, 16) +
        circle(23, 32, 4) +
        circle(47, 32, 4),
    ),
  }),
  ownedEntry({
    id: 'cnc-pocket-depth-test',
    title: 'Pocket Depth Test',
    category: 'CNC Templates',
    subcategory: 'Pocket tests',
    machineModes: ['cnc'],
    operations: ['pocket'],
    tags: ['cnc', 'pocket', 'depth', 'router'],
    svgText: svg(82, 48, gridRects(3, 4, 6, 6, 14, 9)),
  }),
  ownedEntry({
    id: 'cnc-drill-grid',
    title: 'Drill Grid',
    category: 'CNC Templates',
    subcategory: 'Drill tests',
    machineModes: ['cnc'],
    operations: ['drill'],
    tags: ['cnc', 'drill', 'holes', 'grid'],
    svgText: svg(70, 58, circleGrid(4, 5, 10, 10, 12, 2)),
  }),
  ownedEntry({
    id: 'cnc-dogbone-corner-test',
    title: 'Dogbone Corner Test',
    category: 'CNC Templates',
    subcategory: 'Joinery tests',
    machineModes: ['cnc'],
    operations: ['profile', 'drill'],
    tags: ['cnc', 'dogbone', 'corner', 'joinery'],
    svgText: svg(
      55,
      55,
      rect(8, 8, 38, 38) +
        circle(8, 8, 3) +
        circle(46, 8, 3) +
        circle(8, 46, 3) +
        circle(46, 46, 3),
    ),
  }),
  ownedEntry({
    id: 'cnc-v-carve-sample',
    title: 'V-Carve Sample',
    category: 'CNC Templates',
    subcategory: 'V-bit tests',
    machineModes: ['cnc'],
    operations: ['v-carve', 'line'],
    tags: ['cnc', 'v-carve', 'v-bit', 'sample'],
    svgText: svg(
      80,
      45,
      path('M15 7L22 20L15 33L8 20Z') +
        path('M40 7L50 20L40 33L30 20Z') +
        path('M65 7L72 20L65 33L58 20Z') +
        line(6, 39, 74, 39),
    ),
  }),
  ownedEntry({
    id: 'cnc-spoilboard-surfacing',
    title: 'Spoilboard Surfacing Pattern',
    category: 'CNC Templates',
    subcategory: 'Surfacing',
    machineModes: ['cnc'],
    operations: ['pocket', 'calibration'],
    tags: ['cnc', 'surfacing', 'spoilboard', 'flatten'],
    svgText: svg(
      90,
      55,
      path('M5 8L85 8L85 16L5 16L5 24L85 24L85 32L5 32L5 40L85 40L85 48L5 48') + rect(5, 8, 80, 40),
    ),
  }),
  ownedEntry({
    id: 'cnc-hold-down-jig',
    title: 'Hold-Down Jig Strip',
    category: 'Jigs & Fixtures',
    subcategory: 'Workholding',
    machineModes: ['cnc'],
    operations: ['profile', 'drill'],
    tags: ['cnc', 'jig', 'fixture', 'hold-down', 'clamp'],
    svgText: svg(
      100,
      28,
      rect(5, 6, 90, 16) +
        circle(15, 14, 2.2) +
        circle(85, 14, 2.2) +
        rect(32, 11, 12, 6) +
        rect(56, 11, 12, 6),
    ),
  }),
];
