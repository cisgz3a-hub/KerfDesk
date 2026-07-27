// Desk projects: a cross-lapped sign stand and a set of hexagonal coasters.
//
// The stand is laser-dimensioned like the storage projects. The coasters carry
// no joinery at all, so there is no clearance to get wrong and they are offered
// in both modes — the engraved ring is a separate colour and therefore a
// separate operation on import.

import { crossLapFoot, polygonPath } from '../archetypes.mjs';
import { notches, panel } from '../joinery.mjs';
import { finished, part, project, sheet } from '../project.mjs';
import { OP, rect } from '../svg.mjs';

const STOCK_MM = 3;
const LASER_TOOL = 'Laser — assumes kerf 0.2 mm or less';
const SHEET_WIDTH_MM = 300;

const PLATE_WIDTH_MM = 140;
const PLATE_HEIGHT_MM = 90;
const FOOT_WIDTH_MM = 70;
const FOOT_HEIGHT_MM = 30;
const UPRIGHT_SLOT_DEPTH_MM = 12;
// Feet sit symmetrically about the plate centre, so the same pair of positions
// reads identically whichever way the bottom edge is walked.
const FOOT_AT_MM = [35, 105];
const BORDER_INSET_MM = 10;

function signPlate(slotWidthMm) {
  return (ox, oy) => {
    const outline = panel({
      x: ox,
      y: oy,
      width: PLATE_WIDTH_MM,
      height: PLATE_HEIGHT_MM,
      thickness: STOCK_MM,
      clearance: 0,
      edges: {
        bottom: notches(
          FOOT_AT_MM.map((at) => ({
            at: at - slotWidthMm / 2,
            width: slotWidthMm,
            depth: UPRIGHT_SLOT_DEPTH_MM,
          })),
        ),
      },
    });
    // Engrave-coloured border: a second operation on import, and the guide for
    // whatever lettering or artwork the user drops on top.
    const border = rect(
      ox + BORDER_INSET_MM,
      oy + BORDER_INSET_MM,
      PLATE_WIDTH_MM - 2 * BORDER_INSET_MM,
      PLATE_HEIGHT_MM - 2 * BORDER_INSET_MM - UPRIGHT_SLOT_DEPTH_MM,
      OP.engrave,
    );
    return outline + border;
  };
}

function tableSignStand() {
  const foot = crossLapFoot({
    footWidthMm: FOOT_WIDTH_MM,
    footHeightMm: FOOT_HEIGHT_MM,
    uprightSlotDepthMm: UPRIGHT_SLOT_DEPTH_MM,
    thicknessMm: STOCK_MM,
    clearanceMm: 0,
  });
  const parts = [
    part(PLATE_WIDTH_MM, PLATE_HEIGHT_MM, signPlate(foot.slotWidthMm), { name: 'Sign plate' }),
    { ...foot.part, copies: 2 },
  ];
  return project({
    id: 'table-sign-stand',
    title: 'Table Sign Stand',
    category: 'Signs',
    subcategory: 'Table signs',
    collections: [
      'Sign Templates',
      'Wedding Sign Templates',
      'Assembly',
      'Carves in 15 Minutes or Less',
    ],
    machineModes: ['laser'],
    operations: ['cut', 'engrave'],
    tags: ['sign', 'stand', 'cross lap', 'wedding', 'table number'],
    summary:
      'A free-standing sign plate held upright by two cross-lapped feet. The plate slot and the ' +
      'foot slot sum to the foot height, so both parts bottom out on the table at the same time.',
    steps: [
      'Put your own artwork inside the engraved border before cutting — the border is a guide, not decoration.',
      'Cut one plate and two feet.',
      'Slide a foot up into each slot in the plate bottom until it stops.',
      'Stand the assembly up. If it rocks, the slots are not fully seated — press again rather than trimming.',
    ],
    layout: sheet(parts, { maxWidthMm: SHEET_WIDTH_MM }),
    spec: {
      difficulty: 'beginner',
      stockThicknessMm: STOCK_MM,
      partCount: 3,
      estimatedMinutes: 12,
      materials: ['3 mm birch plywood', '3 mm acrylic'],
      bits: [LASER_TOOL],
      finishedSizeMm: finished(PLATE_WIDTH_MM, FOOT_WIDTH_MM, PLATE_HEIGHT_MM),
    },
  });
}

const COASTER_RADIUS_MM = 45;
const COASTER_RING_MM = 38;
const COASTER_STOCK_MM = 6;
// Hexagon with a vertex at the top: flat-to-flat width r*sqrt(3), corner-to-
// corner height 2r.
const COASTER_WIDTH_MM = COASTER_RADIUS_MM * Math.sqrt(3);
const COASTER_HEIGHT_MM = 2 * COASTER_RADIUS_MM;

function hexCoasterSet() {
  const draw = (ox, oy) => {
    const cx = ox + COASTER_WIDTH_MM / 2;
    const cy = oy + COASTER_HEIGHT_MM / 2;
    return (
      polygonPath(cx, cy, COASTER_RADIUS_MM, 6) +
      polygonPath(cx, cy, COASTER_RING_MM, 6, { color: OP.engrave })
    );
  };
  const parts = [part(COASTER_WIDTH_MM, COASTER_HEIGHT_MM, draw, { copies: 4, name: 'Coaster' })];
  return project({
    id: 'hex-coaster-set',
    title: 'Hex Coaster Set',
    category: 'Home Decor',
    subcategory: 'Kitchen and table',
    collections: ['Kitchen', 'Home Decor', 'Gifts', 'Carves in 1 Hour Or Less'],
    machineModes: ['laser', 'cnc'],
    operations: ['cut', 'engrave'],
    tags: ['coaster', 'hexagon', 'gift', 'set of four', 'engrave'],
    summary:
      'Four hexagonal coasters with an engraved inset ring. No joinery and no fit to get wrong, ' +
      'which is why this one runs on either machine from the same file.',
    steps: [
      'On a router, cut the ring first with the V-bit and the outline last, so the part stays held down while it is decorated.',
      'On a laser, engrave the ring first for the same reason.',
      'Cut the four outlines.',
      'Sand the faces and finish with oil or wax. Skip film finishes — a wet glass will lift them.',
    ],
    layout: sheet(parts, { maxWidthMm: SHEET_WIDTH_MM }),
    spec: {
      difficulty: 'beginner',
      stockThicknessMm: COASTER_STOCK_MM,
      partCount: 4,
      estimatedMinutes: 30,
      materials: ['6 mm hardwood', '6 mm plywood'],
      bits: [
        LASER_TOOL,
        'CNC: 3.175 mm (1/8 in) flat endmill for the outline',
        'CNC: 60 degree V-bit for the engraved ring',
      ],
      finishedSizeMm: finished(COASTER_WIDTH_MM, COASTER_HEIGHT_MM, COASTER_STOCK_MM),
    },
  });
}

export const DESK_PROJECTS = [tableSignStand(), hexCoasterSet()];
