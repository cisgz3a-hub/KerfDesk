// slide-lid-referee — proves the ADR-116 V3 style assembles and SLIDES.
// Nominal mode reads the pre-fit builder rings exactly (they are hand-built
// on shared float expressions); play mode reads post-fit rings and checks
// the sliding contract: channel height play == c/2, lid clears the short
// front, and the lid still spans the channels.

import type { Polyline } from '../scene';
import { deriveBoxDims, type BoxSpec } from './box-spec';
import { maxOf, minOf } from '../util';

export type SlideLidRefereePart = {
  readonly panel: string;
  readonly outline: Polyline;
};

export type SlideLidRefereeOptions = {
  readonly playMm?: number;
  readonly toleranceMm?: number;
};

const DEFAULT_TOLERANCE_MM = 6e-3;

/** Empty result = channels, front, and lid geometry all hold. */
export function checkSlideLidAssembly(
  parts: ReadonlyArray<SlideLidRefereePart>,
  spec: BoxSpec,
  options: SlideLidRefereeOptions = {},
): ReadonlyArray<string> {
  const playMm = options.playMm ?? 0;
  const tolMm = playMm === 0 ? 0 : (options.toleranceMm ?? DEFAULT_TOLERANCE_MM);
  const dims = deriveBoxDims(spec);
  const t = spec.thicknessMm;
  const wallHeight = dims.outerHeightMm;
  const channelTop = wallHeight - t;
  const channelBottom = wallHeight - 2 * t;
  const channelEnd = dims.outerDepthMm - 2 * t;
  const issues: string[] = [];
  for (const panel of ['left', 'right'] as const) {
    const wall = parts.find((part) => part.panel === panel);
    if (wall === undefined) {
      issues.push(`${panel}: panel missing`);
      continue;
    }
    issues.push(
      ...checkChannel(wall.outline, panel, {
        channelTop,
        channelBottom,
        channelEnd,
        playMm,
        tolMm,
      }),
    );
  }
  issues.push(...checkFront(parts, t + dims.innerHeightMm, channelBottom, playMm, tolMm));
  issues.push(
    ...checkLid(
      parts,
      { outerWidth: dims.outerWidthMm, shoulder: channelEnd, tongueEnd: dims.outerDepthMm - t, t },
      playMm,
      tolMm,
    ),
  );
  return issues;
}

type ChannelSpec = {
  readonly channelTop: number;
  readonly channelBottom: number;
  readonly channelEnd: number;
  readonly playMm: number;
  readonly tolMm: number;
};

// The C-channel: ceiling and floor runs from the front edge to the back
// post; with play the notch widens by play/4 per flank (height play c/2).
function checkChannel(outline: Polyline, panel: string, channel: ChannelSpec): string[] {
  const issues: string[] = [];
  const ceiling = runsNear(outline, channel.channelTop, channel.tolMm + channel.playMm / 4);
  const floor = runsNear(outline, channel.channelBottom, channel.tolMm + channel.playMm / 4);
  const mouthMax = channel.playMm / 4 + channel.tolMm + 1e-9;
  const ceilingRun = ceiling.find((run) => run.fromMm <= mouthMax);
  const floorRun = floor.find((run) => run.fromMm <= mouthMax);
  if (ceilingRun === undefined || floorRun === undefined) {
    return [`${panel}: channel faces missing at ${channel.channelBottom}..${channel.channelTop}`];
  }
  for (const [face, run] of [
    ['ceiling', ceilingRun],
    ['floor', floorRun],
  ] as const) {
    if (Math.abs(run.toMm - channel.channelEnd) > channel.tolMm + channel.playMm / 4) {
      issues.push(`${panel}: channel ${face} ends at ${run.toMm}, claimed ${channel.channelEnd}`);
    }
  }
  return issues;
}

// The short front tops out at the channel floor so the lid passes over it.
function checkFront(
  parts: ReadonlyArray<SlideLidRefereePart>,
  frontTop: number,
  channelBottom: number,
  playMm: number,
  tolMm: number,
): string[] {
  const front = parts.find((part) => part.panel === 'front');
  if (front === undefined) return ['front: panel missing'];
  const maxY = maxOf(front.outline.points.map((p) => p.y));
  // The fit offset recedes the front's top by play/4 — the lid clearance.
  if (Math.abs(maxY - (frontTop - playMm / 4)) > tolMm) {
    return [`front: tops out at ${maxY}, claimed ${frontTop - playMm / 4}`];
  }
  if (maxY > channelBottom + tolMm) {
    return [`front: intrudes into the lid channel (${maxY} > ${channelBottom})`];
  }
  return [];
}

type LidClaim = {
  readonly outerWidth: number;
  /** Where the full-width part stops against the channel posts. */
  readonly shoulder: number;
  /** The back wall's inner face, where the tongue stops. */
  readonly tongueEnd: number;
  readonly t: number;
};

// The lid spans the full outer width up to the channel posts, then a tongue
// one inner width wide runs between the posts to the back wall's inner face
// (ADR-116 Amd 1: no slit at the back, and the tongue locates the lid
// sideways). The thumb notch sits on its leading edge. With play the fit
// offset recedes every edge by play/4.
function checkLid(
  parts: ReadonlyArray<SlideLidRefereePart>,
  claim: LidClaim,
  playMm: number,
  tolMm: number,
): string[] {
  const lid = parts.find((part) => part.panel === 'lid');
  if (lid === undefined) return ['lid: panel missing'];
  const xs = lid.outline.points.map((p) => p.x);
  const ys = lid.outline.points.map((p) => p.y);
  const issues: string[] = [];
  const width = maxOf(xs) - minOf(xs);
  if (Math.abs(width - (claim.outerWidth - playMm / 2)) > tolMm) {
    issues.push(`lid: width ${width}, claimed ${claim.outerWidth - playMm / 2}`);
  }
  const length = maxOf(ys) - minOf(ys);
  if (Math.abs(length - (claim.tongueEnd - playMm / 2)) > tolMm) {
    issues.push(`lid: length ${length}, claimed ${claim.tongueEnd - playMm / 2}`);
  }
  issues.push(...checkTongue(lid.outline, claim, playMm, tolMm));
  // Thumb notch: material on the leading edge is interrupted around center.
  const leadingRuns = runsNear(lid.outline, minOf(ys), tolMm);
  if (leadingRuns.length < 2) {
    issues.push('lid: thumb notch missing on the leading edge');
  }
  return issues;
}

// The tongue's end runs between the wall inner faces with play/4 per side,
// and each shoulder spans exactly the wall thickness it stops against.
function checkTongue(outline: Polyline, claim: LidClaim, playMm: number, tolMm: number): string[] {
  const inset = playMm / 4;
  const near = (value: number, expected: number): boolean => Math.abs(value - expected) <= tolMm;
  const end = runsNear(outline, claim.tongueEnd - inset, tolMm);
  const tongue = end[0];
  if (
    end.length !== 1 ||
    tongue === undefined ||
    !near(tongue.fromMm, claim.t + inset) ||
    !near(tongue.toMm, claim.outerWidth - claim.t - inset)
  ) {
    return [
      `lid: tongue end ${JSON.stringify(end)}, claimed ${claim.t + inset}..${claim.outerWidth - claim.t - inset}`,
    ];
  }
  const shoulders = runsNear(outline, claim.shoulder - inset, tolMm);
  const left = shoulders[0];
  const right = shoulders[shoulders.length - 1];
  if (
    shoulders.length !== 2 ||
    left === undefined ||
    right === undefined ||
    !near(left.fromMm, inset) ||
    !near(left.toMm, claim.t + inset) ||
    !near(right.fromMm, claim.outerWidth - claim.t - inset) ||
    !near(right.toMm, claim.outerWidth - inset)
  ) {
    return [`lid: shoulders ${JSON.stringify(shoulders)} do not span the channel posts`];
  }
  return [];
}

// Horizontal runs of the ring near a given y line, as sorted x-intervals.
function runsNear(
  ring: Polyline,
  value: number,
  tolMm: number,
): Array<{ fromMm: number; toMm: number }> {
  const out: Array<{ fromMm: number; toMm: number }> = [];
  const pts = ring.points;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p === undefined || q === undefined) continue;
    if (Math.abs(p.y - value) > tolMm || Math.abs(q.y - value) > tolMm) continue;
    if (p.x === q.x) continue;
    out.push({ fromMm: Math.min(p.x, q.x), toMm: Math.max(p.x, q.x) });
  }
  return out.sort((a, b) => a.fromMm - b.fromMm);
}
