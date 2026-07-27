// Storage projects: an open tray and a drop-in drawer grid.
//
// Both are dimensioned for a laser at zero clearance, because the kerf itself
// is the fit: it opens each socket and thins each tab by half a kerf per side.
// Cutting these on a router would leave radiused inside corners that the mating
// tab cannot seat into, so they are not offered in CNC mode — see the workshop
// projects for geometry authored the other way round.

import { eggCrateStrip, tray } from '../archetypes.mjs';
import { finished, part, project, sheet } from '../project.mjs';

const PLY_3MM = '3 mm birch plywood';
const LASER_TOOL = 'Laser — assumes kerf 0.2 mm or less';
const SHEET_WIDTH_MM = 300;

const TRAY_WIDTH_MM = 180;
const TRAY_DEPTH_MM = 120;
const TRAY_HEIGHT_MM = 45;
const STOCK_MM = 3;

function deskTray() {
  const { parts } = tray({
    widthMm: TRAY_WIDTH_MM,
    depthMm: TRAY_DEPTH_MM,
    heightMm: TRAY_HEIGHT_MM,
    thicknessMm: STOCK_MM,
    clearanceMm: 0,
    floorHeightMm: 6,
    cornerFingers: 4,
    floorPins: 3,
  });
  return project({
    id: 'desk-tray',
    title: 'Desk Tray',
    category: 'Home Storage',
    subcategory: 'Trays and boxes',
    collections: [
      'Home Storage',
      'Office and School Supplies',
      'Joinery',
      'Carves in 1 Hour Or Less',
    ],
    machineModes: ['laser'],
    operations: ['cut'],
    tags: ['tray', 'finger joint', 'box', 'desk', 'organizer'],
    summary:
      'Open-top tray with finger-jointed corners and a floor that pins through all four walls. ' +
      'Every tab and its socket come from the same division of the edge, so it dry-fits without glue.',
    steps: [
      'Cut all five parts from one 3 mm sheet. Keep the offcut — it is the test piece for step 2.',
      'Check one corner before assembling: a finger should push home with thumb pressure, not a mallet.',
      'Stand the two long walls up and engage the short walls at each corner.',
      'Drop the floor in from the top so its pins pass through the twelve wall mortises.',
      'Square the box against a flat surface, and glue only if you want it permanent.',
    ],
    layout: sheet(parts, { maxWidthMm: SHEET_WIDTH_MM }),
    spec: {
      difficulty: 'beginner',
      stockThicknessMm: STOCK_MM,
      partCount: 5,
      estimatedMinutes: 25,
      materials: [PLY_3MM],
      bits: [LASER_TOOL],
      finishedSizeMm: finished(TRAY_WIDTH_MM, TRAY_DEPTH_MM, TRAY_HEIGHT_MM),
    },
  });
}

const GRID_WIDTH_MM = 240;
const GRID_DEPTH_MM = 160;
const GRID_HEIGHT_MM = 50;
// Three cross strips split the width into four columns; two long strips split
// the depth into three rows. Both sets are derived from these positions, which
// is what makes every intersection land on a matching pair of slots.
const CROSS_AT_MM = [60, 120, 180];
const LONG_AT_MM = [GRID_DEPTH_MM / 3, (2 * GRID_DEPTH_MM) / 3];

function drawerDividerGrid() {
  const shared = { heightMm: GRID_HEIGHT_MM, thicknessMm: STOCK_MM, clearanceMm: 0 };
  // Long strips slot up from the bottom, cross strips down from the top; each
  // slot is half the strip height, so the two sets finish flush.
  const longStrip = eggCrateStrip({
    ...shared,
    lengthMm: GRID_WIDTH_MM,
    slotPositions: CROSS_AT_MM,
    edge: 'bottom',
  });
  const crossStrip = eggCrateStrip({
    ...shared,
    lengthMm: GRID_DEPTH_MM,
    slotPositions: LONG_AT_MM,
    edge: 'top',
  });
  const parts = [
    part(GRID_WIDTH_MM, GRID_HEIGHT_MM, longStrip, { copies: 2, name: 'Long strip' }),
    part(GRID_DEPTH_MM, GRID_HEIGHT_MM, crossStrip, { copies: 3, name: 'Cross strip' }),
  ];
  return project({
    id: 'drawer-divider-grid',
    title: 'Drawer Divider Grid',
    category: 'Home Storage',
    subcategory: 'Dividers',
    collections: ['Home Storage', 'Office and School Supplies', 'Joinery', 'Assembly'],
    machineModes: ['laser'],
    operations: ['cut'],
    tags: ['divider', 'egg crate', 'drawer', 'organizer', 'no glue'],
    summary:
      'Egg-crate grid that drops into a 240 by 160 mm drawer and splits it into twelve compartments. ' +
      'The strips interlock at half depth and hold themselves together with no glue and no fasteners.',
    steps: [
      'Measure your drawer first. If it is not 240 by 160 mm, edit the strip lengths before cutting — the slot positions are what matter, not the ends.',
      'Cut two long strips and three cross strips.',
      'Stand the two long strips on edge with their slots facing up.',
      'Lower each cross strip onto them so the opposing slots engage.',
      'Press the grid flat on the bench so every joint bottoms out, then drop it into the drawer.',
    ],
    layout: sheet(parts, { maxWidthMm: SHEET_WIDTH_MM }),
    spec: {
      difficulty: 'beginner',
      stockThicknessMm: STOCK_MM,
      partCount: 5,
      estimatedMinutes: 20,
      materials: [PLY_3MM],
      bits: [LASER_TOOL],
      finishedSizeMm: finished(GRID_WIDTH_MM, GRID_DEPTH_MM, GRID_HEIGHT_MM),
    },
  });
}

export const STORAGE_PROJECTS = [deskTray(), drawerDividerGrid()];
