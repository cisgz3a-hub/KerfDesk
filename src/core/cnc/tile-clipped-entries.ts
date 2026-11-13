// Entries for the pieces a tile edge cuts out of a toolpath (ADR-433 amendment,
// N4-P2-1 / P2-advcam-1).
//
// Clipping a toolpath at a tile edge starts a new piece there. Without help
// that piece starts with a straight plunge where the untiled job had none: a
// helical pocket loses its helix, a ramped contour its ramp, and a profile its
// lead, so the plunge lands on the finished wall at every depth level. Here
// each such piece is entered the way its operation asked:
// - a helical pocket: a ramp along the piece at the helix's own slope, its
//   descent at the plunge feed as the helix ran (the helix itself cannot be
//   kept: its circle crosses the tile edge);
// - a ramp entry: the same ramp, along the piece;
// - an Outside or Inside profile: a ramp along the piece, so the cutter is
//   always moving when it reaches depth and leaves no plunge mark on the wall
//   (a lead arc cannot be placed reliably at a tile edge, and the operation's
//   own lead stays where the loop starts).
// Each ramp descends from the level this tile has already cut along the same
// piece, or from the stock top. V-carve detail, tabbed rings and plain-plunge
// operations keep their plunge, and the tiled save counts them.

import {
  cncPassXyPoints,
  type CncContourPass,
  type CncGroup,
  type CncPass,
  type CncPath3dPass,
} from '../job';
import type { CncCutType, Vec2 } from '../scene';
import { rampContourPass } from './contour-ramp-entry';

/** The slope a profile piece ramps at when its layer asks for a lead, not a ramp. */
export const TILE_EDGE_RAMP_DEG = 3;
const MAX_RAMP_ANGLE_DEG = 45;
const DEG_TO_RAD = Math.PI / 180;

/** A clipped piece in stock coordinates, before the tile translation. */
export type ClippedPiece = {
  readonly pass: CncPass;
  /** The piece starts at a tile edge, not where its toolpath started. */
  readonly newEntry: boolean;
  /** The piece came from a helical entry: the helix's start level. */
  readonly helixStartZMm?: number;
};

export type TileEntryKind = 'helix' | 'ramp' | 'lead';

/** What re-planning did to one group's pieces in one tile. */
export type TileEntryReport = {
  readonly cutType: CncCutType;
  readonly kind: TileEntryKind | null;
  /** Pieces that now start with a ramp. */
  readonly ramped: number;
  /** Pieces that still start with a straight plunge below the stock top. */
  readonly plungesKept: number;
};

type Intent = { readonly kind: TileEntryKind; readonly tangent: number };

/** Re-plan the entries of one group's clipped pieces, in pass order. */
export function replanClippedEntries(
  group: CncGroup,
  pieces: ReadonlyArray<ClippedPiece>,
): { readonly passes: ReadonlyArray<CncPass>; readonly report: TileEntryReport } {
  const intent = entryIntent(group);
  // A plain-plunge operation plunges untiled too: its seam plunges are not news.
  const asksForEntry = intent !== null || (group.rampEntryDeg ?? 0) > 0;
  const state: ReplanState = { levels: new Map(), ramped: 0, plungesKept: 0 };
  const passes: CncPass[] = [];
  for (const clipped of pieces) {
    const piece = withOrphanedStayDown(clipped, passes.at(-1));
    const entered = enterPiece(piece, intent, group.toolDiameterMm, state);
    if (entered.plunges && asksForEntry) state.plungesKept += 1;
    passes.push(...entered.passes);
  }
  return {
    passes,
    report: {
      cutType: group.cutType,
      kind: intent?.kind ?? null,
      ramped: state.ramped,
      plungesKept: state.plungesKept,
    },
  };
}

// A ring entered by a stay-down link (ADR-491) has no entry of its own. When
// the tile edge clipped that link away, the ring needs one like any new piece.
function withOrphanedStayDown(piece: ClippedPiece, previous: CncPass | undefined): ClippedPiece {
  const { pass } = piece;
  if (piece.newEntry || pass.kind !== 'contour' || pass.stayDownEntry !== true) return piece;
  const start = pass.polyline[0];
  const end = previous === undefined ? undefined : cncPassXyPoints(previous).at(-1);
  if (start !== undefined && end !== undefined && start.x === end.x && start.y === end.y) {
    return piece;
  }
  const { stayDownEntry: _stayDownEntry, ...entered } = pass;
  return { ...piece, pass: entered, newEntry: true };
}

type ReplanState = {
  /** The level each clipped path has been cut to in this tile (0 = not yet). */
  readonly levels: Map<string, number>;
  ramped: number;
  plungesKept: number;
};

type Entered = { readonly passes: ReadonlyArray<CncPass>; readonly plunges: boolean };

function enterPiece(
  piece: ClippedPiece,
  intent: Intent | null,
  minPathMm: number,
  state: ReplanState,
): Entered {
  const level = levelContour(piece, intent !== null);
  if (level === null) {
    return { passes: [piece.pass], plunges: piece.newEntry && startsBelowStockTop(piece.pass) };
  }
  const key = polylineKey(level.polyline);
  const cutTo = state.levels.get(key) ?? 0;
  state.levels.set(key, Math.min(cutTo, level.zMm));
  if (intent === null || !(piece.newEntry || piece.helixStartZMm !== undefined)) {
    return { passes: [piece.pass], plunges: piece.newEntry && level.zMm < cutTo };
  }
  const fromZ = piece.helixStartZMm ?? cutTo;
  const entered = rampContourPass(level, fromZ, intent.tangent, minPathMm);
  if (entered.kind !== 'path3d') {
    // No ramp fits (too short, or not at coordinate precision): the piece keeps
    // its own motion and plunge, and says why as an untiled pass would.
    return { passes: [withPlungeMarker(piece.pass, entered)], plunges: level.zMm < fromZ };
  }
  state.ramped += 1;
  return {
    // A helical pocket's stand-in descents all run at the plunge feed, as its helix did.
    passes: intent.kind === 'helix' ? helixFedDescent(entered) : [entered],
    plunges: false,
  };
}

function withPlungeMarker(pass: CncPass, planned: CncPass): CncPass {
  if (pass.kind !== 'contour' && pass.kind !== 'path3d') return pass;
  if (pass.entryPlunge === true) return pass;
  if (planned.kind !== 'contour' || planned.entryPlunge !== true) return pass;
  return {
    ...pass,
    entryPlunge: true,
    ...(planned.entryPlungeReason === undefined
      ? {}
      : { entryPlungeReason: planned.entryPlungeReason }),
  };
}

function entryIntent(group: CncGroup): Intent | null {
  if (group.cutType === 'v-carve' || group.cutType.startsWith('relief')) return null;
  const helix = group.passes.find((pass) => pass.kind === 'helical-contour');
  if (helix?.kind === 'helical-contour') return { kind: 'helix', tangent: helixTangent(helix) };
  if (group.rampEntryDeg !== undefined && group.rampEntryDeg > 0) {
    return { kind: 'ramp', tangent: tangentOf(Math.min(group.rampEntryDeg, MAX_RAMP_ANGLE_DEG)) };
  }
  if (group.cutType === 'profile-outside' || group.cutType === 'profile-inside') {
    return { kind: 'lead', tangent: tangentOf(TILE_EDGE_RAMP_DEG) };
  }
  return null;
}

function tangentOf(angleDeg: number): number {
  return Math.tan(angleDeg * DEG_TO_RAD);
}

// The helix's own slope: its drop over the length of its revolutions.
function helixTangent(pass: Extract<CncPass, { readonly kind: 'helical-contour' }>): number {
  const radius = Math.hypot(pass.start.x - pass.center.x, pass.start.y - pass.center.y);
  const revolutions = Math.max(1, Math.floor(pass.revolutions));
  const tangent = (pass.startZMm - pass.zMm) / (revolutions * 2 * Math.PI * radius);
  return Number.isFinite(tangent) && tangent > 0
    ? Math.min(tangent, tangentOf(MAX_RAMP_ANGLE_DEG))
    : tangentOf(TILE_EDGE_RAMP_DEG);
}

// The level contour a piece's entry is planned on, or null when the piece
// keeps its motion as it is. A clipped ramp or stay-down link is flattened to
// its lowest level (a level path3d, such as a lead-in ring, already is one): its whole XY is cut at that level later in the same pass
// anyway, so cutting it there after a fresh ramp removes nothing extra.
function levelContour(piece: ClippedPiece, replanning: boolean): CncContourPass | null {
  const { pass } = piece;
  if (pass.kind === 'contour') return pass;
  if (pass.kind !== 'path3d' || !replanning) return null;
  const flattenable =
    piece.helixStartZMm !== undefined ||
    (piece.newEntry &&
      (pass.entryRamp === true || pass.stayDownLink === true || isLevel(pass.points)));
  if (!flattenable) return null;
  const zMm = pass.points.reduce((min, point) => Math.min(min, point.z), Infinity);
  if (!Number.isFinite(zMm)) return null;
  return {
    kind: 'contour',
    zMm,
    closed: false,
    polyline: pass.points.map((point) => ({ x: point.x, y: point.y })),
  };
}

// A lead-in profile ring is a path3d at one depth; a tab rise is not level.
function isLevel(points: ReadonlyArray<{ readonly z: number }>): boolean {
  const first = points[0]?.z;
  return first !== undefined && points.every((point) => point.z === first);
}

// The helix ran its descent at the plunge feed: so does its stand-in. The
// level part after the descent is ordinary cutting at the cutting feed.
function helixFedDescent(ramped: CncPath3dPass): ReadonlyArray<CncPass> {
  const floor = ramped.points.reduce((min, point) => Math.min(min, point.z), Infinity);
  const reached = ramped.points.findIndex((point) => point.z === floor);
  if (reached <= 0 || reached >= ramped.points.length - 1) {
    return [{ ...ramped, lateralFeed: 'plunge' }];
  }
  const descent: CncPath3dPass = {
    ...ramped,
    points: ramped.points.slice(0, reached + 1),
    lateralFeed: 'plunge',
  };
  // Kept as path3d so the emitter formats its start exactly as the descent's
  // end and carries straight on, with no lift or second plunge between them.
  const level: CncPath3dPass = {
    kind: 'path3d',
    closed: false,
    points: ramped.points.slice(reached),
  };
  return [descent, level];
}

function startsBelowStockTop(pass: CncPass): boolean {
  switch (pass.kind) {
    case 'contour':
    case 'arc':
      return pass.zMm < 0;
    case 'path3d':
      return (pass.points[0]?.z ?? 0) < 0;
    case 'helical-contour':
      return pass.startZMm < 0;
  }
}

function polylineKey(points: ReadonlyArray<Vec2>): string {
  return points.map((point) => `${point.x},${point.y}`).join(';');
}

/** Name the operations re-planned or kept, for the tiled save's advisories. */
export function tileEntryAdvisories(
  reports: ReadonlyArray<TileEntryReport>,
): ReadonlyArray<string> {
  const advisories: string[] = [];
  const replanned = new Map<string, number>();
  const kept = new Map<string, number>();
  for (const report of reports) {
    if (report.ramped > 0 && report.kind !== null) {
      const name = `${operationName(report.cutType)} (${entryName(report.kind)})`;
      replanned.set(name, (replanned.get(name) ?? 0) + report.ramped);
    }
    if (report.plungesKept > 0) {
      const name = operationName(report.cutType);
      kept.set(name, (kept.get(name) ?? 0) + report.plungesKept);
    }
  }
  if (replanned.size > 0) {
    advisories.push(
      'At tile edges these pieces start with a ramp along their own path, descending no faster ' +
        'than the plunge rate, in place of an entry that cannot cross a tile edge (a helix ' +
        'stand-in descends at the plunge feed; a lead stays where its loop starts): ' +
        `${countList(replanned)}.`,
    );
  }
  if (kept.size > 0) {
    advisories.push(
      'At tile edges these pieces still start with a straight plunge below the stock top, at ' +
        `the plunge feed: ${countList(kept)}. Inspect each tile, or place those cuts wholly ` +
        'within one tile, if the bit cannot plunge.',
    );
  }
  return advisories;
}

function countList(counts: ReadonlyMap<string, number>): string {
  return [...counts]
    .map(([name, count]) => `${count} ${count === 1 ? 'piece' : 'pieces'} of ${name}`)
    .join(', ');
}

function entryName(kind: TileEntryKind): string {
  if (kind === 'helix') return 'helical entry';
  if (kind === 'ramp') return 'ramp entry';
  return 'lead-in';
}

/** A cut type as the advisories name it. */
export function operationName(cutType: CncCutType): string {
  switch (cutType) {
    case 'profile-outside':
      return 'Outside profile';
    case 'profile-inside':
      return 'Inside profile';
    case 'profile-on-path':
      return 'On-path profile';
    case 'pocket':
      return 'pocket';
    case 'engrave':
      return 'engrave';
    case 'v-carve':
      return 'V-carve';
    case 'inlay-pair':
      return 'inlay';
    case 'drill':
      return 'drill';
    case 'relief-rough':
      return 'relief roughing';
    case 'relief-finish':
      return 'relief finishing';
  }
}
