// slide-lid-referee — proves the ADR-116 V3 style assembles and SLIDES.
// Nominal mode reads the pre-fit builder rings exactly (they are hand-built
// on shared float expressions); play mode reads post-fit rings and checks
// the sliding contract: channel height play == c/2, lid clears the short
// front, and the lid still spans the channels.

import type { Polyline } from '../scene';
import { deriveBoxDims, type BoxSpec } from './box-spec';

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
  issues.push(...checkLid(parts, dims.outerWidthMm, channelEnd, playMm, tolMm));
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
  const maxY = Math.max(...front.outline.points.map((p) => p.y));
  // The fit offset recedes the front's top by play/4 — the lid clearance.
  if (Math.abs(maxY - (frontTop - playMm / 4)) > tolMm) {
    return [`front: tops out at ${maxY}, claimed ${frontTop - playMm / 4}`];
  }
  if (maxY > channelBottom + tolMm) {
    return [`front: intrudes into the lid channel (${maxY} > ${channelBottom})`];
  }
  return [];
}

// The lid spans the full outer width, stops at the back wall's inner face,
// and carries the thumb notch on its leading edge.
function checkLid(
  parts: ReadonlyArray<SlideLidRefereePart>,
  outerWidth: number,
  channelEnd: number,
  playMm: number,
  tolMm: number,
): string[] {
  const lid = parts.find((part) => part.panel === 'lid');
  if (lid === undefined) return ['lid: panel missing'];
  const xs = lid.outline.points.map((p) => p.x);
  const ys = lid.outline.points.map((p) => p.y);
  const issues: string[] = [];
  const width = Math.max(...xs) - Math.min(...xs);
  if (Math.abs(width - (outerWidth - playMm / 2)) > tolMm) {
    issues.push(`lid: width ${width}, claimed ${outerWidth - playMm / 2}`);
  }
  const length = Math.max(...ys) - Math.min(...ys);
  if (Math.abs(length - (channelEnd - playMm / 2)) > tolMm) {
    issues.push(`lid: length ${length}, claimed ${channelEnd - playMm / 2}`);
  }
  // Thumb notch: material on the leading edge is interrupted around center.
  const leadingRuns = runsNear(lid.outline, Math.min(...ys), tolMm);
  if (leadingRuns.length < 2) {
    issues.push('lid: thumb notch missing on the leading edge');
  }
  return issues;
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
