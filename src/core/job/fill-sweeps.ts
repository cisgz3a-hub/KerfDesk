// fill-sweeps — group per-scanline hatch runs into continuous sweeps.
//
// fillHatching emits one 2-point run per interior span, scanline by scanline,
// in snake order. Emitting each run as its own G0-seek + burn (with a full
// stop at every cut/travel boundary) was the structural cost behind the
// ~2h-vs-LightBurn-~5min fill burn (audit 2026-06-03, ADR-034): a traced image
// fragments each scanline into many short runs.
//
// This module regroups those runs the way LightBurn (and our own raster
// emitter) move: all the runs on one scanline become ONE continuous sweep, and
// the emitter rides a single laser-on G1 across it, blanking the gaps between
// ink spans with S0 instead of lifting to a rapid and stopping.
//
// Runs on the same scanline are exactly collinear (fillHatching computes them
// in a rotated horizontal frame, then rotates the whole set back by one angle).
// So consecutive runs that lie on the same infinite line belong to one sweep;
// a change of line (the next scanline, parallel but offset) starts a new sweep.
// The sweep direction is taken from the group's first run, preserving the snake
// fillHatching already chose. Pure-core: no clock, no random, no I/O.

import type { Vec2 } from '../scene';

export type FillSpan = { readonly start: Vec2; readonly end: Vec2 };

// One scanline's worth of ink spans, ordered along the sweep direction. The
// gap between spans[i].end and spans[i+1].start is interior (a hole) — the
// emitter crosses it with the laser blanked (S0).
export type FillSweep = { readonly reverse: boolean; readonly spans: ReadonlyArray<FillSpan> };

type Run = { readonly start: Vec2; readonly end: Vec2; readonly reverse: boolean };

// Perpendicular distance (mm) below which a point counts as on the group's
// line. Runs on one scanline are collinear to ~1e-12 mm; the next scanline is
// at least MIN_HATCH_SPACING_MM (0.05 mm) away, so 1e-6 mm separates them with
// an enormous margin and never mis-groups two scanlines.
const COLLINEAR_EPS_MM = 1e-6;

export function groupFillSweeps(
  segments: ReadonlyArray<{ readonly polyline: ReadonlyArray<Vec2>; readonly reverse: boolean }>,
): FillSweep[] {
  return groupFillScanlines(segments).flat();
}

export function groupFillScanlines(
  segments: ReadonlyArray<{ readonly polyline: ReadonlyArray<Vec2>; readonly reverse: boolean }>,
): FillSweep[][] {
  const scanlines: FillSweep[][] = [];
  let group: Run[] = [];
  for (const seg of segments) {
    const a = seg.polyline[0];
    const b = seg.polyline[1];
    if (a === undefined || b === undefined || seg.polyline.length !== 2) continue;
    const run: Run = { start: a, end: b, reverse: seg.reverse };
    if (group.length === 0 || canJoinGroup(group[0] as Run, run)) {
      group.push(run);
    } else {
      scanlines.push(buildSweeps(group));
      group = [run];
    }
  }
  if (group.length > 0) scanlines.push(buildSweeps(group));
  return scanlines;
}

function canJoinGroup(first: Run, run: Run): boolean {
  return first.reverse === run.reverse && isOnGroupLine(first, run);
}

// True when both endpoints of `run` lie on the infinite line through the
// group's first run, within COLLINEAR_EPS_MM perpendicular distance.
function isOnGroupLine(first: Run, run: Run): boolean {
  const dx = first.end.x - first.start.x;
  const dy = first.end.y - first.start.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return false;
  return (
    perpDistance(first.start, dx, dy, len, run.start) < COLLINEAR_EPS_MM &&
    perpDistance(first.start, dx, dy, len, run.end) < COLLINEAR_EPS_MM
  );
}

function perpDistance(origin: Vec2, dx: number, dy: number, len: number, p: Vec2): number {
  // |cross((dx,dy), (p - origin))| / |(dx,dy)| = perpendicular distance.
  const cross = dx * (p.y - origin.y) - dy * (p.x - origin.x);
  return Math.abs(cross) / len;
}

// Below this gap width, consecutive ink spans on one scanline stay in a single
// continuous sweep (the emitter blanks the hole with a fast S0 feed move). A
// WIDER gap splits into separate sweeps so the emitter crosses it with a G0
// rapid instead — a hard laser-off (forced off in GRBL laser mode) and faster
// than feeding across empty space. The 2026-06-03 audit found inter-region gaps
// up to ~21mm crossed at cutting feed — the "move to a second part" that left a
// stray line (ADR-035). 5mm sits above the speed break-even (~3.3mm at the
// default feed) and cleanly separates an inter-region gap from a small hole.
export const FILL_GAP_RAPID_THRESHOLD_MM = 5;

// Order a group's runs along the sweep direction (the first run's start->end),
// then split into one or more sweeps wherever the gap to the next span exceeds
// FILL_GAP_RAPID_THRESHOLD_MM. Reverse-snake scanlines (first run pointing -x)
// naturally sort right-to-left, and each returned sweep is one continuous pass;
// fill-sweep-plan owns the motion used at boundaries between those sweeps.
function buildSweeps(runs: Run[]): FillSweep[] {
  const first = runs[0];
  if (first === undefined) return [];
  const dx = first.end.x - first.start.x;
  const dy = first.end.y - first.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const proj = (p: Vec2): number => p.x * ux + p.y * uy;
  const spans: FillSpan[] = runs.map((r) =>
    proj(r.start) <= proj(r.end) ? { start: r.start, end: r.end } : { start: r.end, end: r.start },
  );
  spans.sort((s1, s2) => proj(s1.start) - proj(s2.start));
  const sweeps: FillSweep[] = [];
  let current: FillSpan[] = [];
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i] as FillSpan;
    current.push(span);
    const next = spans[i + 1];
    if (next === undefined) continue;
    const gap = Math.hypot(next.start.x - span.end.x, next.start.y - span.end.y);
    if (gap > FILL_GAP_RAPID_THRESHOLD_MM) {
      sweeps.push({ reverse: first.reverse, spans: current });
      current = [];
    }
  }
  if (current.length > 0) sweeps.push({ reverse: first.reverse, spans: current });
  return sweeps;
}
