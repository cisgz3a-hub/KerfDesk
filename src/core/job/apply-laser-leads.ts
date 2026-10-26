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
// - Scrap side: outside an outer contour, inside a hole, judged among the
//   scene's contours (laser-lead-sides.ts), unless the operation puts every
//   lead outside or inside. A contour whose side is unknown gets no leads.
// - A lead that does not fit is shortened, down to a quarter of its length,
//   or left out (laser-lead-fit.ts); Job Review says how many.
// - Passes: every pass cuts lead-in, contour, lead-out. Overcut (ADR-415) still
//   runs on the final pass only, before the lead-out, which then leaves from
//   where the overcut ends (`finalPassBurn`).
// - Arcs (ADR-432): a contour that goes out as G2/G3 keeps its arcs, and its
//   leads join them as G1 (line) or G2/G3 (arc) moves.
// - Open paths, tab pieces and perforation dashes get no leads; compile says
//   so for tabs and perforation (compile-vector-operation.ts).

import type { DeviceProfile } from '../devices';
import { sampleArcMoves } from '../geometry/arc-fit';
import { overcutClosedPolyline } from '../geometry/overcut';
import type { Scene, Vec2 } from '../scene';
import {
  emittedCutArcMoves,
  validCutArcMoves,
  withCutArcMoves,
  withoutArcMoves,
} from './cut-arc-moves';
import { isEmittableCutSegment } from './cut-emission-resolution';
import type { CutGroup, CutSegment, Job } from './job';
import { countsFor, countSideUnknown, leadDiagnostics, type LeadCounts } from './laser-lead-counts';
import type { CutGroupLaserLeads } from './laser-lead-settings';
import type { JobBounds } from './job-bounds';
import { fitLead, retracesLeadIn, type LeadFit, type LeadFitContext } from './laser-lead-fit';
import { LeadObstacles } from './laser-lead-obstacles';
import {
  backwardTangent,
  contourJoins,
  restartedContours,
  scrapNormal,
} from './laser-lead-contour';
import type { LeadJoin, LeadShape } from './laser-lead-path';
import {
  leadJobLines,
  OBSTACLE_ARC_SAGITTA_MM,
  withoutLeadScaffolding,
  type LeadJobLines,
} from './laser-lead-rings';
import { sceneLeadSideGeometry, type LeadSideVerdict } from './laser-lead-sides';
import {
  leadSpan,
  leadWrap,
  rotaryLeadBed,
  widenLeadSpan,
  wrappedCopies,
  type LeadSpan,
  type LeadWrap,
} from './laser-lead-rotary';
import { hasJobStartPower } from './job-start-power';
import { isBurningLineGroup } from './line-start-region';

export type LaserLeadOptions = {
  /** The physical bed in program coordinates; null when unknown. */
  readonly bed: JobBounds | null;
  /** One turn of the object on an active rotary, in job Y; absent on a flat bed. */
  readonly wrapMm?: number | null;
  /** The machine, so a power that rounds to S0 counts as no burn. */
  readonly device?: DeviceProfile;
  /** The whole scene, output scope aside, whose contours decide each
   * contour's scrap side (ADR-626 Amd 1); absent, the job's own do. */
  readonly scene?: Pick<Scene, 'layers' | 'objects'>;
};

type LeadWorld = LeadJobLines & {
  readonly obstacles: LeadObstacles;
  readonly bed: JobBounds | null;
  readonly wrap: LeadWrap | null;
  /** On an active rotary, the Y the job and its leads so far span. */
  readonly span: LeadSpan | null;
  /** Line ids of the leads placed on each ring so far. */
  readonly leadLines: Map<number, number[]>;
};

export function applyLaserLeads(job: Job, options: LaserLeadOptions): Job {
  if (!job.groups.some((group) => group.kind === 'cut' && group.laserLeads !== undefined))
    return withoutLeadScaffolding(job);
  // As the job start mark judges it: a power the controller rounds to S0
  // burns nothing, so it gets no leads and holds no part.
  const burns = (group: CutGroup): boolean =>
    isBurningLineGroup(group) && hasJobStartPower(group, options.device);
  const scene =
    options.scene === undefined ? undefined : sceneLeadSideGeometry(options.scene, options.device);
  const lines = leadJobLines(job, burns, scene?.contours, scene?.openLines);
  const obstacles = LeadObstacles.create(lines.lines, lines.rings);
  const wrap = leadWrap(options.wrapMm, lines.lines);
  for (const line of lines.lines) {
    for (const copy of wrappedCopies(line, wrap)) obstacles.addLine(copy);
  }
  const world: LeadWorld = {
    ...lines,
    obstacles,
    bed: options.bed,
    wrap,
    span: leadSpan(job, wrap),
    leadLines: new Map(),
  };
  const counts = new Map<string, LeadCounts>();
  const groups = withoutLeadScaffolding(job).groups.map((group, groupIndex) => {
    // A group that burns nothing gets no leads: they would burn nothing too.
    if (group.kind !== 'cut' || group.laserLeads === undefined || !burns(group)) return group;
    const tally = countsFor(counts, group.layerId, group.laserLeads.operationName);
    return {
      ...group,
      segments: group.segments.map((segment, segmentIndex) =>
        // A contour that rounds to one written point is left out of the
        // output; a lead on it would burn on its own.
        segment.closed && isEmittableCutSegment(segment)
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

function leadSegment(
  segment: CutSegment,
  group: CutGroup,
  key: string,
  world: LeadWorld,
  tally: LeadCounts,
): CutSegment {
  // Automatic, and a closed shape on an operation without leads holds it, or
  // open lines close a region round it: it may be a part, so no side is safe.
  const unknown = unknownSide(group, key, world);
  if (unknown !== null) {
    countSideUnknown(tally, unknown);
    return segment;
  }
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
  if (leadIn === null && leadOut === null && (finalPass?.fit ?? null) === null) return segment;
  recordLeads(world, attempt);
  return leadedSegment(attempt.segment, leadIn, leadOut, finalPass, group.passes);
}

/** The verdict that leaves the side unknown, or null when it is known. */
function unknownSide(group: CutGroup, key: string, world: LeadWorld): LeadSideVerdict | null {
  if (group.laserLeads?.side !== 'auto') return null;
  const lineId = world.lineOf.get(key);
  const ringId = lineId === undefined ? undefined : world.ringOfLine.get(lineId);
  const verdict = ringId === undefined ? undefined : world.sides[ringId];
  return verdict?.side === 'unknown' ? verdict : null;
}

type LeadAttempt = {
  readonly segment: CutSegment;
  readonly ringId: number;
  /** The contour, and so its arc leads, go out as G2/G3. */
  readonly arcsEmitted: boolean;
  readonly spec: CutGroupLaserLeads;
  readonly leadIn: LeadFit | null;
  /** The lead-out of every pass but an overcut final pass; null when unused. */
  readonly leadOut: LeadFit | null;
  readonly ordinaryOutBurns: boolean;
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
  const { spec, shape } = plan;
  const planned = finalPassLeadOut(segment, group, spec.leadOut, plan);
  // With one pass and an overcut the final pass is the only one: it goes out
  // as chords, so its lead-in is fitted as chords, and the ordinary lead-out
  // never burns, so it is not fitted and cannot block.
  const ordinaryOutBurns = group.passes > 1 || planned === null;
  const context = ordinaryOutBurns ? plan.context : asChords(plan.context);
  const leadIn = spec.leadIn ? fitLead('in', plan.startJoin, shape, context) : null;
  const fitted =
    spec.leadOut && ordinaryOutBurns ? fitLead('out', plan.endJoin, shape, context) : null;
  // A lead-out back along the lead-in would burn it twice: the contour is
  // started elsewhere instead (leadSegment), where the two part. So would the
  // final pass's, when its overcut runs a whole lap back to the seam.
  const retraces = (out: LeadFit | null): boolean =>
    out !== null && leadIn !== null && retracesLeadIn(out, leadIn, context.clearanceMm);
  const leadOut = retraces(fitted) ? null : fitted;
  const finalPass = planned !== null && retraces(planned.fit) ? { ...planned, fit: null } : planned;
  return {
    segment,
    ringId: plan.ringId,
    arcsEmitted: context.arcsEmitted,
    spec,
    leadIn,
    leadOut,
    ordinaryOutBurns,
    finalPass,
  };
}

// Placed leads are cut lines too: a later contour's leads keep clear of them,
// so two leads aimed into the same scrap cannot burn over each other. Copies
// of this contour ignore them, as they ignore the contour itself. A lead that
// goes out as G2/G3 is indexed as its arcs, sampled as finely as other arc
// obstacles, so a later lead measures from the arc itself; the final pass goes
// out as chords.
function recordLeads(world: LeadWorld, attempt: LeadAttempt): void {
  const burned = [
    ...asBurned(attempt.leadIn, attempt.arcsEmitted),
    ...asBurned(attempt.leadOut, attempt.arcsEmitted),
    ...asBurned(attempt.finalPass?.fit ?? null, false),
  ];
  const placed = burned.map((points) => world.obstacles.addLine(points));
  for (const points of burned) {
    for (const copy of wrappedCopies(points, world.wrap)) world.obstacles.addLine(copy);
  }
  widenLeadSpan(world.span, burned);
  world.leadLines.set(attempt.ringId, [...(world.leadLines.get(attempt.ringId) ?? []), ...placed]);
}

function asBurned(fit: LeadFit | null, arcs: boolean): ReadonlyArray<ReadonlyArray<Vec2>> {
  if (fit === null) return [];
  const start = fit.path.points[0];
  return arcs && start !== undefined && fit.path.moves.some((move) => move.kind === 'arc')
    ? [sampleArcMoves(start, fit.path.moves, OBSTACLE_ARC_SAGITTA_MM)]
    : [fit.path.points];
}

/** Every lead asked for is there, on every pass. */
function complete(attempt: LeadAttempt): boolean {
  return !missingIn(attempt) && !missingOut(attempt);
}

function missingIn(attempt: LeadAttempt): boolean {
  return attempt.spec.leadIn && attempt.leadIn === null;
}

function missingOut(attempt: LeadAttempt): boolean {
  return (
    attempt.spec.leadOut &&
    ((attempt.ordinaryOutBurns && attempt.leadOut === null) || attempt.finalPass?.fit === null)
  );
}

type LeadPlan = {
  readonly ringId: number;
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
    spec.side === 'auto' ? world.sides[ringId]?.side === 'inside' : spec.side === 'inside';
  const join = (at: Vec2, tangent: Vec2): LeadJoin => ({
    at,
    tangent,
    scrap: scrapNormal(tangent, joins.counterClockwise, inside),
  });
  return {
    ringId,
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
// from where the overcut ends, along the contour's direction there, fitted on
// its own: whether the other passes' lead-out fits says nothing about it. The
// pass goes out as chords (withFinalPass), so the lead is fitted as chords.
// Null when the final pass cuts what every other pass cuts.
function finalPassLeadOut(
  segment: CutSegment,
  group: CutGroup,
  leadOutAsked: boolean,
  plan: LeadPlan,
): FinalPass | null {
  const overcutMm = group.finalPassOvercutMm ?? 0;
  if (!(overcutMm > 0)) return null;
  const points = overcutClosedPolyline(segment.polyline, overcutMm);
  if (points === segment.polyline) return null;
  if (!leadOutAsked) return { points, fit: null };
  const end = points[points.length - 1] as Vec2;
  // Read from the overcut run alone (it starts at the closing point), so a
  // run shorter than the tangent window keeps its own heading rather than
  // taking the closing edge's.
  const tangent = backwardTangent(points.slice(segment.polyline.length - 1));
  return {
    points,
    fit:
      tangent === null
        ? null
        : fitLead('out', plan.join(end, tangent), plan.shape, asChords(plan.context)),
  };
}

// A pass that goes out as chords: its leads are fitted as chords, and the
// contour they must not cross is the chords it runs, not the arcs.
function asChords(context: LeadFitContext): LeadFitContext {
  return context.arcsEmitted || context.ownBurn !== context.ownRing
    ? { ...context, arcsEmitted: false, ownBurn: context.ownRing }
    : context;
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
  const contourMoves = validCutArcMoves(segment);
  // The contour runs on from where the lead-in ends, so its range holds on
  // the final pass's burn too, which starts with the same lead-in and ring.
  const leadContour = {
    from: head.length - 1,
    to: head.length - 2 + ring.length,
    ...(contourMoves === null || segment.arcMoves === undefined
      ? {}
      : { arcMoves: segment.arcMoves }),
  };
  const open: CutSegment = { ...withoutArcMoves(segment), polyline, closed: false, leadContour };
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
  // The same outline cut again, by another operation or another group: its
  // lines run along the contour, so a lead cannot keep clear of them, and
  // need not. A copy offset by another kerf runs beside it: the sliver between
  // two cuts of one outline is cut free of the part either way, so a lead
  // crossing it burns nothing that stays, and the copy's leads lie beside these.
  // So is the outline a kerf piece was split from (LeadJobLines.exempt), but
  // only a true copy's leads run beside these: the leads of a whole outline a
  // piece lies in are burns of their own, which the piece's leads keep clear of.
  const exempt = world.exempt[ringId] ?? [];
  const ignoredRings = new Set([ringId, ...exempt]);
  const ignoredLines = new Set([
    lineId,
    ...exempt.flatMap((index) => world.rings[index]?.lineIds ?? []),
    ...(world.copies[ringId] ?? []).flatMap((index) => world.leadLines.get(index) ?? []),
  ]);
  const holders = world.holders[ringId];
  return {
    obstacles: world.obstacles,
    ownLine: lineId,
    ownRing: ring,
    ownBurn: world.lines[lineId] ?? ring,
    ignoredLines,
    ignoredRings,
    inside,
    clearanceMm,
    bed: rotaryLeadBed(world.bed, world.wrap, world.span),
    ringHoldsContour: (index) => holders?.has(index) === true,
  };
}
