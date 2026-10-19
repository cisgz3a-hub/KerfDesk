// Timing and targets for the operation colour pulse (ADR-620, ADR-632). The
// workspace draws artwork in plain ink; pointing at a piece plays one pulse on
// that piece alone, each of its paths in its own operation's colour, and
// pointing at an operation row pulses that operation's artwork. A soft colour
// edge stays while the pointer rests there. Pure: no DOM, no canvas.

import { operationIdsForObject, type Layer, type SceneObject } from '../../core/scene';

export const PULSE_DURATION_MS = 1400;
/** The pointer must settle this long before a hover counts, so a sweep across the bed stays calm. */
export const PULSE_HOVER_DWELL_MS = 90;
/** Strength of the soft colour edge while the pointer rests on the artwork. */
export const PULSE_EDGE_ALPHA = 0.85;
export const PULSE_EDGE_BLUR_PX = 5;

const RISE_END = 0.16;
const HOLD_END = 0.3;
const SWEEP_STEP_MS = 70;
const MAX_STAGGER_MS = 420;
const EDGE_TIME_CONSTANT_MS = 90;
const EDGE_SETTLED = 0.01;

/** Colour strength through one pulse, 0..1: a quick rise, a short hold, a long fade. */
export function pulseStrength(t: number): number {
  if (!(t > 0 && t < 1)) return 0;
  if (t < RISE_END) return easeOutCubic(t / RISE_END);
  if (t < HOLD_END) return 1;
  return 1 - easeInOutCubic((t - HOLD_END) / (1 - HOLD_END));
}

/** The glow that blooms outward and fades as the pulse runs. */
export function pulseGlow(t: number): { readonly blurPx: number; readonly alpha: number } | null {
  if (!(t > 0 && t < 1)) return null;
  return { blurPx: 4 + 22 * easeOutCubic(t), alpha: 0.6 * (1 - t) ** 1.5 };
}

export type PulseSeed =
  | { readonly kind: 'object'; readonly objectId: string }
  | { readonly kind: 'operation'; readonly operationId: string };

export type PulseTarget = {
  /** The operations whose artwork pulses, each in its own colour. */
  readonly operationIds: ReadonlySet<string>;
  readonly objectIds: ReadonlyArray<string>;
  /** Start delay per object, in milliseconds. */
  readonly offsets: ReadonlyMap<string, number>;
};

/**
 * What pulses for a hover: the piece under the pointer alone, in the colours
 * of its own operations, or every piece an operation row's operation draws,
 * swept left to right. Other artwork stays in ink, even when it has the same
 * settings or shares an operation with the hovered piece. `centerOf` places
 * each piece on screen for the sweep.
 */
export function pulseTargetFor(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  seed: PulseSeed,
  centerOf: (object: SceneObject) => { readonly x: number; readonly y: number },
): PulseTarget | null {
  if (seed.kind === 'object') {
    const origin = objects.find((object) => object.id === seed.objectId);
    if (origin === undefined) return null;
    const operationIds = new Set(operationIdsForObject(origin, layers));
    if (operationIds.size === 0) return null;
    return { operationIds, objectIds: [origin.id], offsets: new Map([[origin.id, 0]]) };
  }
  const members = objects.filter((object) =>
    operationIdsForObject(object, layers).includes(seed.operationId),
  );
  if (members.length === 0) return null;
  const pieces = members.map((object) => ({ id: object.id, ...centerOf(object) }));
  return {
    operationIds: new Set([seed.operationId]),
    objectIds: members.map((object) => object.id),
    offsets: pulseStartOffsets(pieces),
  };
}

/** Sweep left to right across an operation's pieces, keeping the whole sweep short. */
export function pulseStartOffsets(
  pieces: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }>,
): ReadonlyMap<string, number> {
  const step =
    pieces.length <= 1 ? 0 : Math.min(SWEEP_STEP_MS, MAX_STAGGER_MS / (pieces.length - 1));
  const sorted = [...pieces].sort((a, b) => a.x - b.x);
  return new Map(sorted.map((piece, rank) => [piece.id, Math.min(MAX_STAGGER_MS, rank * step)]));
}

export type PulsePieceFrame = {
  readonly objectId: string;
  readonly operationIds: ReadonlySet<string>;
  readonly strength: number;
  readonly glow: { readonly blurPx: number; readonly alpha: number } | null;
  readonly edgeAlpha: number;
};

type Entry = {
  start: number | null;
  operationIds: ReadonlySet<string>;
  edge: number;
};

/**
 * One pulse per hover: a piece already mid-pulse finishes the pulse it has
 * rather than restarting. Leaving fades the edge; a running pulse plays out.
 */
export class ArtworkPulseClock {
  private readonly entries = new Map<string, Entry>();
  private hovered: ReadonlySet<string> = new Set();
  private lastNow: number | null = null;

  /** `pulse: false` brings back the edge for a hover that already pulsed. */
  hover(target: PulseTarget, now: number, options: { readonly pulse?: boolean } = {}): void {
    this.hovered = new Set(target.objectIds);
    for (const objectId of target.objectIds) {
      const entry = this.entries.get(objectId) ?? { start: null, operationIds: new Set(), edge: 0 };
      entry.operationIds = target.operationIds;
      if (options.pulse !== false && !isRunning(entry, now)) {
        entry.start = now + (target.offsets.get(objectId) ?? 0);
      }
      this.entries.set(objectId, entry);
    }
  }

  leave(): void {
    this.hovered = new Set();
  }

  /** The pieces to draw at `now`, and whether another frame is needed. */
  frame(
    now: number,
    reducedMotion: boolean,
  ): { readonly pieces: ReadonlyArray<PulsePieceFrame>; readonly busy: boolean } {
    const dt = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const pieces: PulsePieceFrame[] = [];
    let busy = false;
    for (const [objectId, entry] of this.entries) {
      const hovered = this.hovered.has(objectId);
      const step = stepEntry(entry, hovered, now, dt, reducedMotion);
      busy ||= step.busy;
      if (step.piece === null) {
        if (!hovered && entry.start === null) this.entries.delete(objectId);
        continue;
      }
      pieces.push({ objectId, operationIds: entry.operationIds, ...step.piece });
    }
    if (!busy) this.lastNow = null;
    return { pieces, busy };
  }
}

type EntryStep = {
  readonly busy: boolean;
  readonly piece: Omit<PulsePieceFrame, 'objectId' | 'operationIds'> | null;
};

function stepEntry(
  entry: Entry,
  hovered: boolean,
  now: number,
  dt: number,
  reducedMotion: boolean,
): EntryStep {
  const t = entry.start === null ? 1 : (now - entry.start) / PULSE_DURATION_MS;
  if (t >= 1) entry.start = null;
  const running = entry.start !== null;
  const edgeTarget = hovered ? PULSE_EDGE_ALPHA : 0;
  entry.edge = nextEdge(entry.edge, edgeTarget, dt, reducedMotion);
  const busy = (running && !reducedMotion) || entry.edge !== edgeTarget;
  // Reduced motion: no pulse, the colour simply shows while the pointer rests.
  const strength = reducedMotion ? (hovered ? 1 : 0) : pulseStrength(t);
  const glow = reducedMotion ? null : pulseGlow(t);
  if (strength === 0 && glow === null && entry.edge === 0) return { busy, piece: null };
  return { busy, piece: { strength, glow, edgeAlpha: entry.edge } };
}

function isRunning(entry: Entry, now: number): boolean {
  return entry.start !== null && now - entry.start < PULSE_DURATION_MS;
}

function nextEdge(current: number, target: number, dt: number, reducedMotion: boolean): number {
  if (reducedMotion) return target;
  const next = current + (target - current) * (1 - Math.exp(-dt / EDGE_TIME_CONSTANT_MS));
  return Math.abs(target - next) < EDGE_SETTLED ? target : next;
}

function easeOutCubic(x: number): number {
  return 1 - (1 - x) ** 3;
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}
