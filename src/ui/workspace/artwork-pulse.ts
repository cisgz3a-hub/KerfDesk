// Timing and grouping for the operation colour pulse (ADR-620, ADR-632). The
// workspace draws artwork in plain ink; pointing at artwork, or at an
// operation row, swells one soft tint of that operation's colour across every
// piece that shares its settings, rippling out from the piece under the
// pointer. A soft colour edge stays while the pointer rests there. Editing
// settings lights up only the artwork the edit changes (ADR-646). Pure: no
// DOM, no canvas.

import { operationIdsForObject, type Layer, type SceneObject } from '../../core/scene';
import { sameOperationSettings, type MachineKind } from './pulse-settings-match';

export type { MachineKind } from './pulse-settings-match';

export const PULSE_DURATION_MS = 1900;
/** The pointer must settle this long before a hover counts, so a sweep across the bed stays calm. */
export const PULSE_HOVER_DWELL_MS = 90;
/** Peak colour strength: the tint lets the ink line show through rather than repainting it. */
export const PULSE_PEAK_STRENGTH = 0.78;
/** Strength of the soft colour edge while the pointer rests on the artwork. */
export const PULSE_EDGE_ALPHA = 0.5;
export const PULSE_EDGE_BLUR_PX = 8;
/** The wider, softer halo that breathes with the pulse. Both halos are blurred once per piece. */
export const PULSE_BLOOM_BLUR_PX = 16;

/** The swell peaks a third of the way in, then ebbs slowly: no flash, no flat hold. */
const SWELL_PEAK = 0.34;
const GLOW_PEAK_ALPHA = 0.34;
const RIPPLE_BASE_MS = 110;
const RIPPLE_MS_PER_PX = 0.8;
const SWEEP_STEP_MS = 90;
const MAX_STAGGER_MS = 560;
const EDGE_TIME_CONSTANT_MS = 180;
const EDGE_SETTLED = 0.01;

/** One breath through the pulse, 0..1: an eased swell, then a long, eased ebb. */
function swell(t: number): number {
  if (!(t > 0 && t < 1)) return 0;
  if (t < SWELL_PEAK) return easeInOutSine(t / SWELL_PEAK);
  return 1 - easeInOutSine((t - SWELL_PEAK) / (1 - SWELL_PEAK));
}

/** Colour strength through one pulse: it swells gently to a soft tint and ebbs back to ink. */
export function pulseStrength(t: number): number {
  return PULSE_PEAK_STRENGTH * swell(t);
}

/** A faint halo that breathes with the colour: the bloom's strength, 0..GLOW_PEAK_ALPHA. */
export function pulseGlowAlpha(t: number): number {
  return GLOW_PEAK_ALPHA * swell(t);
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
  | { readonly kind: 'operation'; readonly operationId: string }
  /** A settings edit (ADR-646): exactly the artwork it changes, never widened to same settings. */
  | {
      readonly kind: 'edit';
      /** The editor holding it: focus moving to another editor is a new edit, even on the same artwork. */
      readonly owner: string;
      /**
       * New for each edit that begins, so one that ended and began again while
       * a hover hid it still pulses when it shows (ADR-646 Amendment 1).
       */
      readonly serial: number;
      readonly objectIds: ReadonlyArray<string>;
      readonly operationIds: ReadonlyArray<string>;
    };

/** Identifies one hover (or edit), so the same one set again is recognised. */
export function pulseSeedKey(seed: PulseSeed | null): string {
  if (seed === null) return '';
  if (seed.kind === 'object') return `o:${seed.objectId}`;
  if (seed.kind === 'operation') return `r:${seed.operationId}`;
  return `e:${JSON.stringify([seed.serial, seed.owner, seed.objectIds, seed.operationIds])}`;
}

/**
 * Whether the hover now in force should pulse, or only bring back its edge.
 * Called once per change of hover, scene or canvas piece.
 */
export class PulseTrigger {
  private lastSeedKey = '';
  private pulsedObjectId: string | null = null;
  private pulsedEditKey: string | null = null;
  private lastScene: unknown = undefined;

  next(seed: PulseSeed | null, canvasObjectId: string | null, scene: unknown): boolean {
    const seedKey = pulseSeedKey(seed);
    // An edit during the hover (Paste settings on the hovered row, say) can
    // change which operations share its settings: regroup without pulsing again.
    const sameHover = seedKey !== '' && seedKey === this.lastSeedKey;
    this.lastSeedKey = seedKey;
    const sceneChanged = scene !== this.lastScene;
    this.lastScene = scene;
    const resumedPiece = this.rememberCanvasPiece(seed, canvasObjectId);
    if (seed?.kind !== 'edit') {
      if (seed === null) this.pulsedEditKey = null;
      return !(sameHover || resumedPiece);
    }
    // An edit pulses when it begins and again with every change it makes
    // (ADR-646). A hover over it and back is the same edit: its edge returns,
    // no pulse. The clock lets a running pulse finish, so dragging a slider
    // pulses at the pulse's own pace rather than restarting on every step.
    const editResumed = seedKey === this.pulsedEditKey;
    this.pulsedEditKey = seedKey;
    return !editResumed || (sameHover && sceneChanged);
  }

  /**
   * A click or drag pauses the canvas hover. Coming back to the same piece
   * is still the same hover: its edge returns without a second pulse.
   */
  private rememberCanvasPiece(seed: PulseSeed | null, canvasObjectId: string | null): boolean {
    const resumed = seed?.kind === 'object' && seed.objectId === this.pulsedObjectId;
    if (seed?.kind === 'object') this.pulsedObjectId = seed.objectId;
    else if (canvasObjectId === null) this.pulsedObjectId = null;
    return resumed;
  }
}

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
  if (seed.kind === 'edit') return editPulseTarget(objects, layers, seed, centerOf);
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

/**
 * An edit changes its own artwork only: other pieces that happen to share
 * the settings keep theirs, so they stay dark. Each operation shows in its
 * own colour, and only the parts of a piece that use the edited operations
 * light up.
 */
function editPulseTarget(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  seed: Extract<PulseSeed, { readonly kind: 'edit' }>,
  centerOf: (object: SceneObject) => { readonly x: number; readonly y: number },
): PulseTarget | null {
  const colorSources = new Map(
    layers
      .filter((layer) => seed.operationIds.includes(layer.id))
      .map((layer) => [layer.id, layer.id]),
  );
  const members = objects.filter(
    (object) =>
      seed.objectIds.includes(object.id) &&
      operationIdsForObject(object, layers).some((id) => colorSources.has(id)),
  );
  if (members.length === 0) return null;
  const pieces = members.map((object) => ({ id: object.id, ...centerOf(object) }));
  return {
    colorSources,
    objectIds: members.map((object) => object.id),
    offsets: pulseStartOffsets(pieces, null),
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
  readonly glowAlpha: number;
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
  const strength = reducedMotion ? (hovered ? PULSE_PEAK_STRENGTH : 0) : pulseStrength(t);
  const glowAlpha = reducedMotion ? 0 : pulseGlowAlpha(t);
  if (strength === 0 && glowAlpha === 0 && entry.edge === 0) return { busy, piece: null };
  return { busy, piece: { strength, glowAlpha, edgeAlpha: entry.edge } };
}

function isRunning(entry: Entry, now: number): boolean {
  return entry.start !== null && now - entry.start < PULSE_DURATION_MS;
}

function nextEdge(current: number, target: number, dt: number, reducedMotion: boolean): number {
  if (reducedMotion) return target;
  const next = current + (target - current) * (1 - Math.exp(-dt / EDGE_TIME_CONSTANT_MS));
  return Math.abs(target - next) < EDGE_SETTLED ? target : next;
}

function easeInOutSine(x: number): number {
  return (1 - Math.cos(Math.PI * x)) / 2;
}
