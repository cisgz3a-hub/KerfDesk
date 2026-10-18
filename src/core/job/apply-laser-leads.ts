// Laser lead-in and lead-out (ADR-626, LBG-C14): the heavier burn where a
// cut starts and stops lands in the scrap instead of on the finished edge.
//
// Runs once in preparation, after the planner has chosen where every closed
// contour starts (closed-shape starts, ADR-494) and the job start point has
// been applied, so each lead joins the contour where the beam actually starts
// and stops. A closed contour of a Line cut group whose operation asks for
// leads becomes one open burn: lead-in, the contour, lead-out. Every output
// (GRBL, Marlin, Smoothieware, Ruida), the preview, both time estimates, Frame
// and Job Review bounds read the job's segments, so they all carry the leads
// without knowing about them. A group without leads is returned as is, so a
// job without leads is the same object and its output is byte-identical.
//
// - Scrap side: outside an outer contour, inside a hole (laser-lead-rings.ts),
//   unless the operation puts every lead outside or inside.
// - A lead that does not fit is shortened, down to a quarter of its length,
//   or left out (laser-lead-fit.ts); Job Review says how many.
// - Passes: every pass cuts lead-in, contour, lead-out. Overcut (ADR-415) still
//   runs on the final pass only, before the lead-out, which then leaves from
//   where the overcut ends (`finalPassBurn`).
// - Arcs (ADR-432): a contour that goes out as G2/G3 keeps its arcs, and its
//   leads join them as G1 (line) or G2/G3 (arc) moves.
// - Open paths, tab pieces and perforation dashes get no leads; compile says
//   so for tabs and perforation (compile-vector-operation.ts).

import { overcutClosedPolyline } from '../geometry/overcut';
import type { Vec2 } from '../scene';
import { outlineInsideContainer } from './containment-depth';
import {
  emittedCutArcMoves,
  validCutArcMoves,
  withCutArcMoves,
  withoutArcMoves,
} from './cut-arc-moves';
import type { CutGroup, CutSegment, Job, JobDiagnostic } from './job';
import type { CutGroupLaserLeads } from './laser-lead-settings';
import type { JobBounds } from './job-bounds';
import { fitLead, type LeadFit, type LeadFitContext } from './laser-lead-fit';
import { LeadObstacles } from './laser-lead-obstacles';
import {
  backwardTangent,
  contourJoins,
  restartedContours,
  scrapNormal,
} from './laser-lead-contour';
import type { LeadJoin, LeadShape } from './laser-lead-path';
import { leadJobLines, type LeadJobLines } from './laser-lead-rings';
import { boundsContains } from './segment-bounds';

export type LaserLeadOptions = {
  /** The physical bed in program coordinates; null when unknown. */
  readonly bed: JobBounds | null;
};

type LeadWorld = LeadJobLines & {
  readonly obstacles: LeadObstacles;
  readonly bed: JobBounds | null;
};

type LeadCounts = { readonly layerName: string; shortened: number; omitted: number };

/** The bed a lead must stay on: the program's bed, but on an active rotary
 * only its X limits. The rotary rebases Y and flat-bed Y placement means
 * nothing there, so the same artwork gets the same leads wherever it sits. */
export function laserLeadBed(bed: JobBounds | null, rotary: boolean): JobBounds | null {
  if (bed === null || !rotary) return bed;
  return {
    minX: bed.minX,
    maxX: bed.maxX,
    minY: Number.NEGATIVE_INFINITY,
    maxY: Number.POSITIVE_INFINITY,
  };
}

export function applyLaserLeads(job: Job, options: LaserLeadOptions): Job {
  if (!job.groups.some((group) => group.kind === 'cut' && group.laserLeads !== undefined))
    return withoutTopologyRings(job);
  const lines = leadJobLines(job);
  const world: LeadWorld = {
    ...lines,
    obstacles: LeadObstacles.create(lines.lines, lines.rings),
    bed: options.bed,
  };
  const counts = new Map<string, LeadCounts>();
  const groups = withoutTopologyRings(job).groups.map((group, groupIndex) => {
    if (group.kind !== 'cut' || group.laserLeads === undefined) return group;
    const tally = countsFor(counts, group.layerId, group.laserLeads.operationName);
    return {
      ...group,
      segments: group.segments.map((segment, segmentIndex) =>
        segment.closed
          ? leadSegment(segment, group, `${groupIndex}:${segmentIndex}`, world, tally)
          : segment,
      ),
    };
  });
  const diagnostics = leadDiagnostics(counts);
  return {
    ...job,
    groups,
    ...(diagnostics.length === 0
      ? {}
      : { diagnostics: [...(job.diagnostics ?? []), ...diagnostics] }),
  };
}

// The broken-contour outlines compile kept for leads (CutGroup.topologyRings)
// are spent once leads are placed: dropped, so no later transform of the job
// can leave them stale. A job without them is the same object.
function withoutTopologyRings(job: Job): Job {
  if (!job.groups.some((group) => group.kind === 'cut' && group.topologyRings !== undefined))
    return job;
  return {
    ...job,
    groups: job.groups.map((group) => {
      if (group.kind !== 'cut' || group.topologyRings === undefined) return group;
      const { topologyRings: _spent, ...rest } = group;
      return rest;
    }),
  };
}

// By operation id: two operations can share a name (each parent's Sub-layer 1).
function countsFor(counts: Map<string, LeadCounts>, layerId: string, name: string): LeadCounts {
  const existing = counts.get(layerId);
  if (existing !== undefined) return existing;
  const created = { layerName: name, shortened: 0, omitted: 0 };
  counts.set(layerId, created);
  return created;
}

function leadDiagnostics(counts: ReadonlyMap<string, LeadCounts>): JobDiagnostic[] {
  return [...counts.entries()]
    .filter(([, tally]) => tally.shortened > 0 || tally.omitted > 0)
    .map(([layerId, tally]) => ({
      kind: 'laser-leads-adjusted',
      layerId,
      layerName: tally.layerName,
      shortened: tally.shortened,
      omitted: tally.omitted,
    }));
}

function leadSegment(
  segment: CutSegment,
  group: CutGroup,
  key: string,
  world: LeadWorld,
  tally: LeadCounts,
): CutSegment {
  const planned = leadAttempt(segment, group, key, world);
  if (planned === null) {
    tally.omitted += 1;
    return segment;
  }
  // Where the planner starts a contour may leave no room (a hole's corner):
  // start it in the middle of a nearby edge instead, if every lead fits there.
  const attempt = complete(planned)
    ? planned
    : (restartedContours(segment)
        .map((restarted) => leadAttempt(restarted, group, key, world))
        .find((candidate) => candidate !== null && complete(candidate)) ?? planned);
  tallyContour(tally, attempt);
  const { leadIn, leadOut, finalPass } = attempt;
  if (leadIn === null && leadOut === null) return segment;
  return leadedSegment(attempt.segment, leadIn, leadOut, finalPass, group.passes);
}

type LeadAttempt = {
  readonly segment: CutSegment;
  readonly spec: CutGroupLaserLeads;
  readonly leadIn: LeadFit | null;
  readonly leadOut: LeadFit | null;
  readonly finalPass: FinalPass | null;
};

function leadAttempt(
  segment: CutSegment,
  group: CutGroup,
  key: string,
  world: LeadWorld,
): LeadAttempt | null {
  const plan = leadPlan(segment, group, key, world);
  if (plan === null) return null;
  const { spec, shape, context } = plan;
  const leadIn = spec.leadIn ? fitLead('in', plan.startJoin, shape, context) : null;
  const leadOut = spec.leadOut ? fitLead('out', plan.endJoin, shape, context) : null;
  const finalPass = finalPassLeadOut(segment, group, leadOut, plan);
  return { segment, spec, leadIn, leadOut, finalPass };
}

/** Every lead asked for is there, on every pass. */
function complete(attempt: LeadAttempt): boolean {
  return !missingIn(attempt) && !missingOut(attempt);
}

function missingIn(attempt: LeadAttempt): boolean {
  return attempt.spec.leadIn && attempt.leadIn === null;
}

function missingOut(attempt: LeadAttempt): boolean {
  return attempt.spec.leadOut && (attempt.leadOut === null || attempt.finalPass?.fit === null);
}

type LeadPlan = {
  readonly spec: CutGroupLaserLeads;
  readonly shape: LeadShape;
  readonly context: LeadFitContext;
  readonly startJoin: LeadJoin;
  readonly endJoin: LeadJoin;
  readonly join: (at: Vec2, tangent: Vec2) => LeadJoin;
};

function leadPlan(
  segment: CutSegment,
  group: CutGroup,
  key: string,
  world: LeadWorld,
): LeadPlan | null {
  const spec = group.laserLeads;
  const lineId = world.lineOf.get(key);
  const ringId = lineId === undefined ? undefined : world.ringOfLine.get(lineId);
  const moves = emittedCutArcMoves(segment, {
    arcMovesEnabled: true,
    entryRunwayMm: group.entryRunwayMm,
  });
  const joins = contourJoins(segment.polyline, moves);
  if (spec === undefined || lineId === undefined || ringId === undefined || joins === null)
    return null;
  const inside =
    spec.side === 'auto' ? (world.depths[ringId] ?? 0) % 2 === 1 : spec.side === 'inside';
  const join = (at: Vec2, tangent: Vec2): LeadJoin => ({
    at,
    tangent,
    scrap: scrapNormal(tangent, joins.counterClockwise, inside),
  });
  return {
    spec,
    shape: { style: spec.style, lengthMm: spec.lengthMm, angleDeg: spec.angleDeg },
    context: {
      ...fitContext(segment.polyline, lineId, ringId, inside, spec.clearanceMm, world),
      arcsEmitted: moves !== null,
    },
    startJoin: join(joins.start, joins.startTangent),
    endJoin: join(joins.end, joins.endTangent),
    join,
  };
}

// One count per contour: left out when an asked-for lead is missing on any
// pass, else shortened when any of its leads is shorter than asked.
function tallyContour(tally: LeadCounts, attempt: LeadAttempt): void {
  if (!complete(attempt)) tally.omitted += 1;
  else if (
    [attempt.leadIn, attempt.leadOut, attempt.finalPass?.fit].some((fit) => fit?.shortened === true)
  )
    tally.shortened += 1;
}

type FinalPass = {
  /** The final pass's contour: round once, then on past the start. */
  readonly points: ReadonlyArray<Vec2>;
  /** Its lead-out from where the overcut ends; null when that does not fit. */
  readonly fit: LeadFit | null;
};

// The final pass overcuts past the start (ADR-415); its lead-out then leaves
// from where the overcut ends, along the contour's direction there. Null when
// the final pass cuts what every other pass cuts.
function finalPassLeadOut(
  segment: CutSegment,
  group: CutGroup,
  leadOut: LeadFit | null,
  plan: LeadPlan,
): FinalPass | null {
  const overcutMm = group.finalPassOvercutMm ?? 0;
  if (!(overcutMm > 0)) return null;
  const points = overcutClosedPolyline(segment.polyline, overcutMm);
  if (points === segment.polyline) return null;
  if (leadOut === null) return { points, fit: null };
  const end = points[points.length - 1] as Vec2;
  // Read from the overcut run alone (it starts at the closing point), so a
  // run shorter than the tangent window keeps its own heading rather than
  // taking the closing edge's.
  const tangent = backwardTangent(points.slice(segment.polyline.length - 1));
  return {
    points,
    fit:
      tangent === null ? null : fitLead('out', plan.join(end, tangent), plan.shape, plan.context),
  };
}

function leadedSegment(
  segment: CutSegment,
  leadIn: LeadFit | null,
  leadOut: LeadFit | null,
  finalPass: FinalPass | null,
  passes: number,
): CutSegment {
  const ring = segment.polyline;
  const head = leadIn === null ? ring.slice(0, 1) : leadIn.path.points;
  const polyline = [...head, ...ring.slice(1), ...(leadOut?.path.points.slice(1) ?? [])];
  const open: CutSegment = { ...withoutArcMoves(segment), polyline, closed: false };
  const contourMoves = validCutArcMoves(segment);
  const withArcs =
    contourMoves === null
      ? open
      : withCutArcMoves(open, [
          ...(leadIn?.path.moves ?? []),
          ...contourMoves,
          ...(leadOut?.path.moves ?? []),
        ]);
  return finalPass === null ? withArcs : withFinalPass(open, withArcs, head, finalPass, passes);
}

// The final pass's own burn: lead-in, the overcut contour, its own lead-out.
// With one pass the final pass is the only one, so it is the segment's burn
// and no reader can count a path that never runs.
function withFinalPass(
  open: CutSegment,
  withArcs: CutSegment,
  head: ReadonlyArray<Vec2>,
  finalPass: FinalPass,
  passes: number,
): CutSegment {
  const tail = finalPass.fit?.path.points.slice(1) ?? [];
  const polyline = [...head, ...finalPass.points.slice(1), ...tail];
  return passes <= 1 ? { ...open, polyline } : { ...withArcs, finalPassBurn: { polyline } };
}

function fitContext(
  ring: ReadonlyArray<Vec2>,
  lineId: number,
  ringId: number,
  inside: boolean,
  clearanceMm: number,
  world: LeadWorld,
): Omit<LeadFitContext, 'arcsEmitted'> {
  const own = world.rings[ringId];
  // The same outline cut again, by another operation or another group: its
  // lines run along the contour, so a lead cannot keep clear of them, and
  // need not.
  const copies = world.copies[ringId] ?? [];
  const ignoredRings = new Set([ringId, ...copies]);
  const ignoredLines = new Set([
    lineId,
    ...copies.flatMap((index) => world.rings[index]?.lineIds ?? []),
  ]);
  const holds = new Map<number, boolean>();
  return {
    obstacles: world.obstacles,
    ownLine: lineId,
    ownRing: ring,
    ignoredLines,
    ignoredRings,
    inside,
    clearanceMm,
    bed: world.bed,
    ringHoldsContour: (index) => {
      const known = holds.get(index);
      if (known !== undefined) return known;
      const container = world.rings[index];
      const result =
        own !== undefined &&
        container !== undefined &&
        boundsContains(container.bounds, own.bounds) &&
        outlineInsideContainer(ring, container.points);
      holds.set(index, result);
      return result;
    },
  };
}
