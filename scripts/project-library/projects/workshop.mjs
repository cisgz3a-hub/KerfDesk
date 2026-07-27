// Workshop projects, both authored the CNC way round.
//
// Neither one relies on a square inside corner that a round cutter cannot
// reach: the gauge is holes, and the clamp's slot is an obround whose ends are
// already the cutter's radius. That is why these two carry no dogbone relief —
// they do not need any, rather than having had it forgotten.

import { obround, tabMarks } from '../joinery.mjs';
import { bare, finished, project } from '../project.mjs';
import { circle, OP, rect } from '../svg.mjs';
import { canRender, label } from '../stroke-font.mjs';

const ENDMILL = 'CNC: 3.175 mm (1/8 in) flat endmill';

const GAUGE_WIDTH_MM = 160;
const GAUGE_HEIGHT_MM = 60;
const GAUGE_STOCK_MM = 6;
const GAUGE_HOLE_Y_MM = 22;
const GAUGE_LABEL_Y_MM = 40;
const GAUGE_LABEL_CAP_MM = 8;
const GAUGE_TITLE_CAP_MM = 5;
// Every nominal diameter here is larger than the 3.175 mm cutter, so each hole
// is interpolated rather than plunged. A hole at or under the bit diameter
// could not be produced at all, which is why the series starts at 4 mm.
const GAUGE_HOLES = [
  { diameterMm: 4, xMm: 20 },
  { diameterMm: 5, xMm: 44 },
  { diameterMm: 6, xMm: 68 },
  { diameterMm: 8, xMm: 92 },
  { diameterMm: 10, xMm: 116 },
  { diameterMm: 12, xMm: 140 },
];

function holeSizeGauge() {
  const title = 'HOLE GAUGE MM';
  if (!canRender(title)) throw new Error('stroke font cannot render the gauge title');
  const draw = () => {
    const holes = GAUGE_HOLES.map((hole) =>
      circle(hole.xMm, GAUGE_HOLE_Y_MM, hole.diameterMm / 2, OP.drill),
    ).join('');
    // The number beside each hole is the whole point: an unlabelled set of
    // holes cannot be read back with calipers once it is off the machine.
    const labels = GAUGE_HOLES.map((hole) =>
      label(String(hole.diameterMm), hole.xMm, GAUGE_LABEL_Y_MM, GAUGE_LABEL_CAP_MM, {
        align: 'center',
      }),
    ).join('');
    return (
      rect(0, 0, GAUGE_WIDTH_MM, GAUGE_HEIGHT_MM) +
      holes +
      labels +
      label(title, GAUGE_WIDTH_MM / 2, 6, GAUGE_TITLE_CAP_MM, { align: 'center' })
    );
  };
  return project({
    id: 'hole-size-gauge',
    title: 'Hole Size Gauge',
    category: 'Shop Gear and Tools',
    subcategory: 'Setup and calibration',
    collections: [
      'Shop Gear and Tools',
      'Carves in 15 Minutes or Less',
      'Smart Values',
      'Assembly',
    ],
    machineModes: ['cnc'],
    operations: ['cut', 'engrave', 'drill'],
    tags: ['calibration', 'gauge', 'setup', 'accuracy', 'shop tool'],
    summary:
      'Six holes of known nominal diameter, each engraved with its size. Cut one, measure the ' +
      'holes with calipers, and the difference from nominal is your machine and bit error in one number.',
    steps: [
      'Cut the plate from 6 mm stock with a sharp 3.175 mm endmill. A dull bit is exactly the error you are trying to measure, so do not use a worn one.',
      'Measure each hole with calipers and write the actual figure next to the engraved nominal.',
      'A hole that measures consistently under nominal means the cutter is running larger than its marked diameter, or the machine is losing steps on direction changes.',
      'Feed that difference back as your cut offset before running a job where fit matters.',
    ],
    layout: bare(GAUGE_WIDTH_MM, GAUGE_HEIGHT_MM, draw),
    spec: {
      difficulty: 'beginner',
      stockThicknessMm: GAUGE_STOCK_MM,
      partCount: 1,
      estimatedMinutes: 10,
      materials: ['6 mm MDF', '6 mm plywood'],
      bits: [ENDMILL],
      finishedSizeMm: finished(GAUGE_WIDTH_MM, GAUGE_HEIGHT_MM, GAUGE_STOCK_MM),
    },
  });
}

const CLAMP_WIDTH_MM = 140;
const CLAMP_HEIGHT_MM = 32;
const CLAMP_STOCK_MM = 12;
const CLAMP_SLOT_LENGTH_MM = 70;
// 8.5 mm clears an M8 bolt with room to slide; the obround's semicircular ends
// are cut by the tool's own radius, so no corner relief is required.
const CLAMP_SLOT_WIDTH_MM = 8.5;
const CLAMP_TAB_COUNT = 4;
const CLAMP_TAB_WIDTH_MM = 4;
const CLAMP_MARGIN_MM = 6;

function clampBar(oy) {
  const slotX = CLAMP_MARGIN_MM + (CLAMP_WIDTH_MM - CLAMP_SLOT_LENGTH_MM) / 2;
  const slotY = oy + (CLAMP_HEIGHT_MM - CLAMP_SLOT_WIDTH_MM) / 2;
  return (
    rect(CLAMP_MARGIN_MM, oy, CLAMP_WIDTH_MM, CLAMP_HEIGHT_MM) +
    obround(slotX, slotY, CLAMP_SLOT_LENGTH_MM, CLAMP_SLOT_WIDTH_MM, OP.pocket) +
    // Score-coloured bridge marks: where the part stays attached to the stock
    // so it cannot lift into the cutter on the final pass.
    tabMarks(
      CLAMP_MARGIN_MM,
      oy,
      CLAMP_WIDTH_MM,
      CLAMP_HEIGHT_MM,
      CLAMP_TAB_COUNT,
      CLAMP_TAB_WIDTH_MM,
    )
  );
}

function holdDownClamp() {
  const sheetWidth = CLAMP_WIDTH_MM + 2 * CLAMP_MARGIN_MM;
  const sheetHeight = 2 * CLAMP_HEIGHT_MM + 3 * CLAMP_MARGIN_MM;
  const draw = () => clampBar(CLAMP_MARGIN_MM) + clampBar(2 * CLAMP_MARGIN_MM + CLAMP_HEIGHT_MM);
  return project({
    id: 'cnc-hold-down-clamp',
    title: 'CNC Hold-Down Clamp Pair',
    category: 'Shop Gear and Tools',
    subcategory: 'Workholding',
    collections: ['Shop Gear and Tools', 'Smart Values', 'Carves in 15 Minutes or Less'],
    machineModes: ['cnc'],
    operations: ['cut', 'pocket'],
    tags: ['workholding', 'clamp', 'shop tool', 'tabs', 'M8'],
    summary:
      'A pair of slotted bars that bolt to a T-track or threaded insert and hold stock down at the ' +
      'edge. The obround slot gives 61 mm of travel, so one pair covers a wide range of stock sizes.',
    steps: [
      'Cut from 12 mm stock. Hardwood lasts longer than plywood here because the slot takes the bolt load every time.',
      'Cut the slot pocket first, then the outline, so the bar is still fully supported while the slot is machined.',
      'The four score marks are holding tabs — leave them attached until the job finishes, then cut them with a flush saw.',
      'Bolt through the slot with an M8 bolt and a washer wide enough to bridge it.',
      'Set the clamp so it presses down on the stock, not at an angle — a tilted clamp lifts the far edge.',
    ],
    layout: bare(sheetWidth, sheetHeight, draw),
    spec: {
      difficulty: 'intermediate',
      stockThicknessMm: CLAMP_STOCK_MM,
      partCount: 2,
      estimatedMinutes: 20,
      materials: ['12 mm hardwood', '12 mm plywood'],
      bits: [ENDMILL],
      finishedSizeMm: finished(CLAMP_WIDTH_MM, CLAMP_HEIGHT_MM, CLAMP_STOCK_MM),
    },
  });
}

export const WORKSHOP_PROJECTS = [holeSizeGauge(), holdDownClamp()];
