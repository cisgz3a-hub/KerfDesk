// What the Inspector says about the move under the pointer (ADR-470): the
// source line, what kind of move it is, where on it the pointer is, the feed
// and power in force, and when the tool gets there. Pure, so the words and
// numbers are unit-tested apart from the pick pass that finds the move.

import { SEG_KIND, SEG_MOTION } from '../../core/gcode-view';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dPick } from '../viewer3d/scene-pick';
import type { InspectorRenderModel } from './inspector-model';
import { formatClock } from './InspectorTimeline';

export type MoveReadout = {
  /** Zero-based raw source line of the move. */
  readonly line: number;
  readonly title: string;
  readonly position: string;
  readonly settings: string;
  /** Seconds into the job at the pointed point; null without timing. */
  readonly seconds: number | null;
  readonly time: string | null;
};

const KIND_LABEL: Readonly<Record<number, string>> = {
  [SEG_KIND.travel]: 'Traversal',
  [SEG_KIND.cut]: 'Cut',
  [SEG_KIND.plunge]: 'Plunge',
  [SEG_KIND.retract]: 'Retract',
};

const MOTION_WORD: Readonly<Record<number, string>> = {
  [SEG_MOTION.rapid]: 'G0',
  [SEG_MOTION.linear]: 'G1',
  [SEG_MOTION.cw]: 'G2',
  [SEG_MOTION.ccw]: 'G3',
};

export function moveReadout(
  model: InspectorRenderModel,
  segTimeEndSec: Float32Array | null,
  pick: Viewer3dPick,
): MoveReadout {
  const index = pick.segmentIndex;
  const line = model.segLine[index] ?? 0;
  const kind = KIND_LABEL[model.segKind[index] ?? SEG_KIND.travel] ?? 'Move';
  const motion = model.segMotion[index] ?? SEG_MOTION.linear;
  const seconds = secondsAtPick(segTimeEndSec, pick);
  const { point } = pick;
  return {
    line,
    title: `Line ${line + 1} · ${kind} (${MOTION_WORD[motion] ?? 'G1'})`,
    position: `X ${point.x.toFixed(2)}   Y ${point.y.toFixed(2)}   Z ${point.z.toFixed(2)} mm`,
    settings: settingsText(model, index, motion),
    seconds,
    time: seconds === null ? null : `Reached at ${formatClock(seconds)}`,
  };
}

/** Planner seconds at the pointed point, interpolated along its move. */
export function secondsAtPick(
  segTimeEndSec: Float32Array | null,
  pick: Pick<Viewer3dPick, 'segmentIndex' | 'fraction'>,
): number | null {
  const index = pick.segmentIndex;
  if (segTimeEndSec === null || index < 0 || index >= segTimeEndSec.length) return null;
  const start = index === 0 ? 0 : (segTimeEndSec[index - 1] ?? 0);
  const end = segTimeEndSec[index] ?? start;
  return start + (end - start) * Math.min(1, Math.max(0, pick.fraction));
}

function settingsText(model: InspectorRenderModel, index: number, motion: number): string {
  const feed = model.segFeed[index] ?? 0;
  const power = model.segPower[index] ?? 0;
  const feedText =
    motion === SEG_MOTION.rapid
      ? 'F rapid'
      : feed > 0
        ? `F ${Math.round(feed)} mm/min`
        : 'F not set';
  if (model.stats.powerMax === null) return feedText;
  return `${feedText}   S ${Number(power.toFixed(2))}`;
}

export type MeasureReadout = {
  readonly distance: string;
  readonly deltas: string;
};

/** The straight-line distance between two measured points and its X Y Z parts. */
export function measureReadout(
  from: Viewer3dPick['point'],
  to: Viewer3dPick['point'],
): MeasureReadout {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return {
    distance: `${Math.hypot(dx, dy, dz).toFixed(2)} mm`,
    deltas: `ΔX ${hundredths(dx)}   ΔY ${hundredths(dy)}   ΔZ ${hundredths(dz)} mm`,
  };
}

// Two decimals, without the "-0.00" a rounding speck below zero would show.
function hundredths(value: number): string {
  const text = value.toFixed(2);
  return text === '-0.00' ? '0.00' : text;
}
