// Timing and grouping for the operation colour pulse (ADR-620). The workspace
// draws artwork in plain ink; pointing at artwork, or at an operation row,
// plays one pulse in that operation's colour across every piece that shares
// its settings, rippling out from the piece under the pointer. A soft colour
// edge stays while the pointer rests there. Pure: no DOM, no canvas.

import {
  layerOperationSettingsEqual,
  operationIdsForObject,
  type Layer,
  type SceneObject,
} from '../../core/scene';

export const PULSE_DURATION_MS = 1400;
/** The pointer must settle this long before a hover counts, so a sweep across the bed stays calm. */
export const PULSE_HOVER_DWELL_MS = 90;
/** Strength of the soft colour edge while the pointer rests on the artwork. */
export const PULSE_EDGE_ALPHA = 0.55;
export const PULSE_EDGE_BLUR_PX = 6;

const RISE_END = 0.16;
const HOLD_END = 0.3;
const RIPPLE_BASE_MS = 80;
const RIPPLE_MS_PER_PX = 0.6;
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

export type MachineKind = 'laser' | 'cnc';

/** Same settings for the active machine; name, colour and visibility do not count. */
export function sameOperationSettings(a: Layer, b: Layer, machine: MachineKind): boolean {
  if (machine === 'cnc') return JSON.stringify(a.cnc) === JSON.stringify(b.cnc);
  return (
    layerOperationSettingsEqual(a, b) && JSON.stringify(a.subLayers) === JSON.stringify(b.subLayers)
  );
}

/**
 * The seed operations plus every operation whose settings match one of them,
 * each mapped to the seed whose colour it pulses in. Every artwork has its own
 * operation colour, so a same-settings group would otherwise flash as a
 * rainbow; one colour per group says "these share the settings you point at".
 */
export function pulseColorSources(
  layers: ReadonlyArray<Layer>,
  seedIds: ReadonlyArray<string>,
  machine: MachineKind,
): ReadonlyMap<string, string> {
  const seeds = layers.filter((layer) => seedIds.includes(layer.id));
  const sources = new Map<string, string>();
  for (const layer of layers) {
    const seed =
      seeds.find((candidate) => candidate.id === layer.id) ??
      seeds.find((candidate) => sameOperationSettings(candidate, layer, machine));
    if (seed !== undefined) sources.set(layer.id, seed.id);
  }
  return sources;
}

export type PulseSeed =
  | { readonly kind: 'object'; readonly objectId: string }
  | { readonly kind: 'operation'; readonly operationId: string };

/** Operation id → id of the operation whose colour its artwork pulses in. */
export type PulseColorSources = ReadonlyMap<string, string>;

export type PulseTarget = {
  readonly colorSources: PulseColorSources;
  readonly objectIds: ReadonlyArray<string>;
  /** Start delay per object, in milliseconds. */
  readonly offsets: ReadonlyMap<string, number>;
};

/**
 * Everything that pulses for a hover: the hovered artwork's operations (or
 * the hovered row's) widened to every operation with the same settings, and
 * the artwork that uses them. `centerOf` places each piece on screen so the
 * pulse can ripple out from the hovered piece, or sweep left to right from a row.
 */
export function pulseTargetFor(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  machine: MachineKind,
  seed: PulseSeed,
  centerOf: (object: SceneObject) => { readonly x: number; readonly y: number },
): PulseTarget | null {
  let seedIds: ReadonlyArray<string> = seed.kind === 'operation' ? [seed.operationId] : [];
  let originId: string | null = null;
  if (seed.kind === 'object') {
    const origin = objects.find((object) => object.id === seed.objectId);
    if (origin === undefined) return null;
    seedIds = operationIdsForObject(origin, layers);
    originId = origin.id;
  }
  const colorSources = pulseColorSources(layers, seedIds, machine);
  if (colorSources.size === 0) return null;
  const members = objects.filter((object) =>
    operationIdsForObject(object, layers).some((id) => colorSources.has(id)),
  );
  if (members.length === 0) return null;
  const pieces = members.map((object) => ({ id: object.id, ...centerOf(object) }));
  return {
    colorSources,
    objectIds: members.map((object) => object.id),
    offsets: pulseStartOffsets(pieces, originId),
  };
}

/** Ripple outward from the origin by screen distance, or sweep left to right without one. */
export function pulseStartOffsets(
  pieces: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }>,
  originId: string | null,
): ReadonlyMap<string, number> {
  const origin = pieces.find((piece) => piece.id === originId);
  if (origin !== undefined) {
    return new Map(
      pieces.map((piece) => {
        if (piece.id === origin.id) return [piece.id, 0];
        const distance = Math.hypot(piece.x - origin.x, piece.y - origin.y);
        return [piece.id, Math.min(MAX_STAGGER_MS, RIPPLE_BASE_MS + distance * RIPPLE_MS_PER_PX)];
      }),
    );
  }
  const step =
    pieces.length <= 1 ? 0 : Math.min(SWEEP_STEP_MS, MAX_STAGGER_MS / (pieces.length - 1));
  const sorted = [...pieces].sort((a, b) => a.x - b.x);
  return new Map(sorted.map((piece, rank) => [piece.id, Math.min(MAX_STAGGER_MS, rank * step)]));
}

export type PulsePieceFrame = {
  readonly objectId: string;
  readonly colorSources: PulseColorSources;
  readonly strength: number;
  readonly glow: { readonly blurPx: number; readonly alpha: number } | null;
  readonly edgeAlpha: number;
};

type Entry = {
  start: number | null;
  colorSources: PulseColorSources;
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
      const entry = this.entries.get(objectId) ?? { start: null, colorSources: new Map(), edge: 0 };
      entry.colorSources = target.colorSources;
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
      pieces.push({ objectId, colorSources: entry.colorSources, ...step.piece });
    }
    if (!busy) this.lastNow = null;
    return { pieces, busy };
  }
}

type EntryStep = {
  readonly busy: boolean;
  readonly piece: Omit<PulsePieceFrame, 'objectId' | 'colorSources'> | null;
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
