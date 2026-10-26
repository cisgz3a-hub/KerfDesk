// The cut lines and closed rings of a prepared laser job, as laser leads see
// them (ADR-626), and which side of each closed contour is scrap.
//
// Every segment of every Line cut group is a line a lead must keep clear of.
// Every closed segment is a ring. A contour that tabs or perforation broke into
// pieces is a ring too: compile keeps its whole outline on the cut group
// (CutGroup.topologyRings), matched to its pieces by their topology identity
// (ADR-486 Amd 2), across the cut group and its tab-span group. Without that, a
// lead could slip through two tab gaps and burn across the part.
//
// The scrap side is judged among the scene's contours (laser-lead-sides.ts,
// ADR-626 Amd 1), so output scope and output switches cannot change it, and a
// closed shape on an operation without leads cannot flip it. Each ring takes
// the verdict of the scene contour compile says it was cut from
// (CutSegment.leadSource); copies of one scene contour, however each
// operation offsets it, are one outline. A job handed in without the scene is
// judged among its own rings by the same rule, its operations with leads
// deciding. Which rings hold a ring, for the free-end check, is judged among
// the job's own rings: those are the lines actually cut.
//
// Except that the lines are not all on the sheet's parts: Cut selected
// graphics and an operation with output off leave parts uncut that stay on the
// sheet, to be cut before or after. A lead must not burn into them either
// (Amendment 10), so their contours join the rings and their lines the lines,
// after the job's own, and are never led. A contour the job also cuts, by some
// operation, or a copy of one, is left to the ring the job cuts.

import { sampleArcMoves } from '../geometry/arc-fit';
import type { Vec2 } from '../scene';
import { emittedCutArcMoves } from './cut-arc-moves';
import type { CutGroup, CutSegment, CutTopologyRing, Job } from './job';
import { copyLists, leadOutline } from './laser-lead-copies';
import type { LeadRing } from './laser-lead-obstacles';
import type { SceneOpenLine } from './laser-lead-open-outlines';
import { pieceClasses, pieceExemptions, pieceLookup, type PieceLookup } from './laser-lead-pieces';
import { leadSideVerdicts, type LeadSideContour, type LeadSideVerdict } from './laser-lead-sides';
import { isBurningLineGroup } from './line-start-region';
import { properContourAncestors } from './proper-contour-containment';

export type LeadJobLines = {
  /** Every cut line, by line id. */
  readonly lines: ReadonlyArray<ReadonlyArray<Vec2>>;
  /** Line id of each Line cut segment, keyed by `group:segment`. */
  readonly lineOf: ReadonlyMap<string, number>;
  readonly rings: ReadonlyArray<LeadRing>;
  /** Ring id of each closed segment's line. */
  readonly ringOfLine: ReadonlyMap<number, number>;
  /** The scrap side of each ring under Lead side automatic. */
  readonly sides: ReadonlyArray<LeadSideVerdict>;
  /** The rings, copies included, that wholly hold each ring. */
  readonly holders: ReadonlyArray<ReadonlySet<number>>;
  /** The other rings that are copies of each ring. */
  readonly copies: ReadonlyArray<ReadonlyArray<number>>;
  /** The rings each ring's leads may cross and end inside: its copies, and
   * every ring another operation cuts from the same scene contour over it. */
  readonly exempt: ReadonlyArray<ReadonlyArray<number>>;
  /** Lines from this id on are the uncut parts' (Amendment 10). */
  readonly uncutFrom: number;
};

/** The lines the output leaves uncut, in job coordinates (Amendment 10). A
 * closed one carries the key of its scene contour (laserLeadSourceKey). */
export type UncutLeadLines = {
  readonly contours: ReadonlyArray<{ readonly key: string; readonly points: ReadonlyArray<Vec2> }>;
  readonly openLines: ReadonlyArray<ReadonlyArray<Vec2>>;
};

const NOTHING_UNCUT: UncutLeadLines = { contours: [], openLines: [] };

/** `burns` says which cut groups really burn; others hold no part. `scene`:
 * the scene's contours the scrap side is judged among (sceneLeadSideContours);
 * absent, the job's own rings are. `openLines`: the scene's open Line cuts,
 * which leave a contour in a region they close without a side (Amendment 8).
 * `uncut`: the scene's lines the output does not cut, which leads keep clear
 * of and never end inside (Amendment 10). */
export function leadJobLines(
  job: Job,
  burns: (group: CutGroup) => boolean = isBurningLineGroup,
  scene?: ReadonlyArray<LeadSideContour>,
  openLines: ReadonlyArray<SceneOpenLine> = [],
  uncut: UncutLeadLines = NOTHING_UNCUT,
): LeadJobLines {
  const lines: Array<ReadonlyArray<Vec2>> = [];
  const lineOf = new Map<string, number>();
  const rings: LeadRing[] = [];
  // Each ring's group; for a job judged alone, its operation and whether that
  // asks for leads.
  const owners: RingOwner[] = [];
  const ringOfLine = new Map<number, number>();
  const pieces = new Map<string, { ids: number[]; owner: (typeof owners)[number] }>();
  job.groups.forEach((group, groupIndex) => {
    // A group that burns nothing (zero power, an artwork at 0% power, or a
    // power the controller rounds to S0) cuts no line and holds no part: it is
    // neither an obstacle nor a container.
    if (group.kind !== 'cut' || !burns(group)) return;
    const owner = {
      group: groupIndex,
      decides: group.laserLeads !== undefined,
      operationName: group.laserLeads?.operationName ?? group.layerId,
    };
    group.segments.forEach((segment, segmentIndex) => {
      const lineId = lines.length;
      lines.push(burnLine(segment, group.entryRunwayMm));
      lineOf.set(`${groupIndex}:${segmentIndex}`, lineId);
      if (segment.closed) {
        ringOfLine.set(lineId, rings.length);
        rings.push(ring(segment.polyline, [lineId], segment.leadSource));
        owners.push(owner);
        return;
      }
      const nesting = segment.nesting;
      if (nesting?.topologyContour === undefined) return;
      const key = `${nesting.forest}\u0000${nesting.topologyContour}`;
      const entry = pieces.get(key);
      if (entry === undefined) pieces.set(key, { ids: [lineId], owner });
      else {
        entry.ids.push(lineId);
        if (owner.decides) entry.owner = owner;
      }
    });
  });
  const whole = topologyOutlines(job);
  for (const [key, { ids, owner }] of pieces) {
    const outline = whole.get(key);
    if (outline === undefined || outline.polyline.length < 3) continue;
    // The whole outline, its uncut gaps included, is a line a lead keeps clear
    // of too: a lead slipping through two tab gaps would burn across the part.
    const bridged = lines.length;
    lines.push(closedOutline(outline.polyline));
    rings.push(ring(outline.polyline, [...ids, bridged], outline.leadSource));
    owners.push(owner);
  }
  const parts = pieceLookup(rings);
  const groups = owners.map((owner) => owner.group);
  const { sides, sceneClasses, verdicts } = ringSides(rings, owners, { scene, openLines }, parts);
  const representatives = classRepresentatives(sides.map((side) => side.copyClass));
  const copies = copyLists(representatives);
  const exempt = pieceExemptions(rings, groups, copies, parts, sceneClasses);
  const uncutFrom = lines.length;
  appendUncut(
    { lines, rings, sides, representatives, copies, exempt },
    uncut,
    verdicts,
    new Set(sceneClasses),
  );
  return {
    lines,
    lineOf,
    rings,
    ringOfLine,
    sides,
    holders: ringHolders(rings, representatives, copies),
    copies,
    exempt,
    uncutFrom,
  };
}

type RingLists = {
  readonly lines: Array<ReadonlyArray<Vec2>>;
  readonly rings: LeadRing[];
  readonly sides: LeadSideVerdict[];
  readonly representatives: number[];
  readonly copies: number[][];
  readonly exempt: number[][];
};

// Each uncut contour once, unless the job cuts it or a copy of it: as a ring
// that holds what lies inside it, and as a line, as a cut ring is. Its own
// leads, copies and exemptions are none. Uncut open lines are lines only.
function appendUncut(
  into: RingLists,
  uncut: UncutLeadLines,
  verdicts: ReadonlyMap<string, LeadSideVerdict>,
  cutClasses: ReadonlySet<number>,
): void {
  const placed = new Set<number>();
  for (const contour of uncut.contours) {
    const verdict = verdicts.get(contour.key);
    if (verdict !== undefined) {
      if (cutClasses.has(verdict.copyClass) || placed.has(verdict.copyClass)) continue;
      placed.add(verdict.copyClass);
    }
    const lineId = into.lines.length;
    into.lines.push(closedOutline(contour.points));
    into.representatives.push(into.rings.length);
    into.rings.push(ring(contour.points, [lineId], contour.key));
    into.sides.push(verdict ?? { side: 'unknown', copyClass: Number.NaN, aroundName: '' });
    into.copies.push([]);
    into.exempt.push([]);
  }
  for (const points of uncut.openLines) into.lines.push(points);
}

// Each ring's verdict: its scene contour's, or with no scene, its own among the
// job's rings. A ring compile could not trace to a scene contour gets none.
function ringSides(
  rings: ReadonlyArray<LeadRing>,
  owners: ReadonlyArray<RingOwner>,
  {
    scene,
    openLines,
  }: {
    readonly scene: ReadonlyArray<LeadSideContour> | undefined;
    readonly openLines: ReadonlyArray<SceneOpenLine>;
  },
  parts: PieceLookup,
): {
  readonly sides: LeadSideVerdict[];
  readonly sceneClasses: ReadonlyArray<number>;
  /** The scene contours' verdicts, by key; none without a scene. */
  readonly verdicts: ReadonlyMap<string, LeadSideVerdict>;
} {
  if (scene === undefined) {
    const own = leadSideVerdicts(
      rings.map((ring, index) => ({
        key: String(index),
        points: ring.points,
        decides: owners[index]?.decides === true,
        operationName: owners[index]?.operationName ?? '',
      })),
    );
    const sides = rings.map((_, index) => own.get(String(index)) as LeadSideVerdict);
    return { sides, sceneClasses: sides.map((side) => side.copyClass), verdicts: new Map() };
  }
  const verdicts = leadSideVerdicts(scene, openLines);
  const fresh = verdicts.size;
  const sides = rings.map(
    (ring, index): LeadSideVerdict =>
      (ring.source === undefined ? undefined : verdicts.get(ring.source)) ?? {
        side: 'unknown',
        copyClass: fresh + index,
        aroundName: '',
      },
  );
  // The class each ring's scene contour has, coincident contours sharing one,
  // before the pieces some operation split them into are told apart.
  const sceneClasses = sides.map((side) => side.copyClass);
  pieceClasses(
    rings,
    owners.map((owner) => owner.group),
    sides,
    fresh,
    parts,
  );
  return { sides, sceneClasses, verdicts };
}

type RingOwner = Pick<LeadSideContour, 'decides' | 'operationName'> & { readonly group: number };

/** For each ring, the first ring of its copy class. */
function classRepresentatives(classes: ReadonlyArray<number>): number[] {
  const first = new Map<number, number>();
  return classes.map((copyClass, index) => {
    const known = first.get(copyClass);
    if (known !== undefined) return known;
    first.set(copyClass, index);
    return index;
  });
}

// Which rings hold each ring is judged once per outline, its copies aside, and
// then holds for every copy of the container.
function ringHolders(
  rings: ReadonlyArray<LeadRing>,
  representatives: ReadonlyArray<number>,
  copies: ReadonlyArray<ReadonlyArray<number>>,
): ReadonlyArray<ReadonlySet<number>> {
  const unique = rings.flatMap((_, index) => (representatives[index] === index ? [index] : []));
  const ancestors = properContourAncestors(
    unique.map((index) => ({ polyline: rings[index]?.points ?? [], closed: true })),
  );
  const at = new Map(unique.map((ring, position) => [ring, position]));
  return rings.map((_, index) => {
    const containers = (ancestors[at.get(representatives[index] ?? index) ?? -1] ?? []).map(
      (container) => unique[container] as number,
    );
    return new Set(containers.flatMap((ring) => [ring, ...(copies[ring] ?? [])]));
  });
}

// The line as it burns: on an arc machine a contour that goes out as G2/G3
// bows past its chords, so its moves are sampled finely enough that a lead's
// clearance from it is measured from the arc itself (ADR-432 decides by the
// same predicate). Otherwise the chords are the burn.
export const OBSTACLE_ARC_SAGITTA_MM = 0.002;

function burnLine(segment: CutSegment, entryRunwayMm: number | undefined): ReadonlyArray<Vec2> {
  const moves = emittedCutArcMoves(segment, { arcMovesEnabled: true, entryRunwayMm });
  const first = segment.polyline[0];
  if (moves === null || first === undefined) return segment.polyline;
  return sampleArcMoves(first, moves, OBSTACLE_ARC_SAGITTA_MM);
}

function topologyOutlines(job: Job): ReadonlyMap<string, CutTopologyRing> {
  const outlines = new Map<string, CutTopologyRing>();
  for (const group of job.groups) {
    if (group.kind !== 'cut') continue;
    for (const topology of group.topologyRings ?? []) {
      outlines.set(`${topology.forest}\u0000${topology.contour}`, topology);
    }
  }
  return outlines;
}

function closedOutline(outline: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = outline[0] as Vec2;
  const last = outline[outline.length - 1] as Vec2;
  return first.x === last.x && first.y === last.y ? outline : [...outline, first];
}

function ring(
  points: ReadonlyArray<Vec2>,
  lineIds: ReadonlyArray<number>,
  source: string | undefined,
): LeadRing {
  return { ...leadOutline(points), lineIds, ...(source === undefined ? {} : { source }) };
}

// What compile kept for leads, the broken-contour outlines
// (CutGroup.topologyRings) and each contour's scene contour
// (CutSegment.leadSource), is spent once leads are placed: dropped, so no
// later transform of the job can leave it stale. A job without it is the same
// object.
export function withoutLeadScaffolding(job: Job): Job {
  if (!job.groups.some(hasLeadScaffolding)) return job;
  return {
    ...job,
    groups: job.groups.map((group) => {
      if (group.kind !== 'cut' || !hasLeadScaffolding(group)) return group;
      const { topologyRings: _spent, ...rest } = group;
      return { ...rest, segments: rest.segments.map(withoutLeadSource) };
    }),
  };
}

function hasLeadScaffolding(group: Job['groups'][number]): boolean {
  return (
    group.kind === 'cut' &&
    (group.topologyRings !== undefined ||
      group.segments.some((segment) => segment.leadSource !== undefined))
  );
}

function withoutLeadSource(segment: CutSegment): CutSegment {
  if (segment.leadSource === undefined) return segment;
  const { leadSource: _spent, ...rest } = segment;
  return rest;
}
