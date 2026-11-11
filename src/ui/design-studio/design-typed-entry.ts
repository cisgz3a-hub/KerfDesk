// design-typed-entry — the options-bar boxes a draw gesture can be typed into,
// and what Enter does with them (ADR-272 Amendment 5, Phase N DS-3c).
//
// Each draw tool names the quantities an operator would type (a line's length
// and angle, a rectangle's width and height, a circle's radius or diameter,
// an arc's radius, start angle and sweep). While a gesture is live the boxes
// show the live values; a typed box LOCKS its quantity, and the pointer keeps
// steering the rest. The locks ride on the gesture itself, so they vanish with
// it — Esc, a tool switch, or the commit leaves nothing behind.

import {
  parseEntryValue,
  withEntryLock,
  type EntryLockKey,
  type EntryLocks,
  type EntryParse,
} from '../../core/design/entry';
import { distance } from '../../core/geometry/point-math';
import type { Vec2 } from '../../core/scene';
import {
  circleRadiusMm,
  draftAngleDeg,
  draftLengthMm,
  draftRectMm,
  type DesignDraft,
} from './design-draft';
import { handlePointToolClick } from './design-point-pointer';
import {
  finishOpenPath,
  lockedArcTarget,
  lockedPathTarget,
  type ArcPointSequence,
  type PathPointSequence,
} from './design-point-sequence';
import type { DesignSession } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import type { DesignToolKind } from './design-tool';

export type EntryFieldKey = EntryLockKey | 'diameter';

export type EntryFieldView = {
  readonly key: EntryFieldKey;
  // The lock this box writes. Diameter writes the radius at half its value.
  readonly lock: EntryLockKey;
  readonly label: string;
  readonly unit: 'mm' | 'deg';
  // The live value while a gesture is drawing, else null (the box is idle).
  readonly value: number | null;
  readonly locked: boolean;
};

type FieldSpec = Pick<EntryFieldView, 'key' | 'lock' | 'label' | 'unit'>;

const LENGTH: FieldSpec = { key: 'length', lock: 'length', label: 'Length', unit: 'mm' };
const ANGLE: FieldSpec = { key: 'angle', lock: 'angle', label: 'Angle', unit: 'deg' };
const WIDTH: FieldSpec = { key: 'width', lock: 'width', label: 'Width', unit: 'mm' };
const HEIGHT: FieldSpec = { key: 'height', lock: 'height', label: 'Height', unit: 'mm' };
const RADIUS: FieldSpec = { key: 'radius', lock: 'radius', label: 'Radius', unit: 'mm' };
const DIAMETER: FieldSpec = { key: 'diameter', lock: 'radius', label: 'Diameter', unit: 'mm' };
const SWEEP: FieldSpec = { key: 'sweep', lock: 'sweep', label: 'Sweep', unit: 'deg' };

const TOOL_FIELDS: Partial<Record<DesignToolKind, ReadonlyArray<FieldSpec>>> = {
  line: [LENGTH, ANGLE],
  rect: [WIDTH, HEIGHT],
  circle: [RADIUS, DIAMETER],
  path: [LENGTH, ANGLE],
  arc: [RADIUS, ANGLE, SWEEP],
};

const RAD_TO_DEG = 180 / Math.PI;
const FULL_TURN_DEG = 360;

export function hasTypedEntry(tool: DesignToolKind): boolean {
  return TOOL_FIELDS[tool] !== undefined;
}

/** A gesture is live — and therefore typeable — between its first point and its commit. */
export function isEntryGestureLive(session: DesignSession): boolean {
  return session.draft !== null || session.pointSequence !== null;
}

export function entryFieldsFor(session: DesignSession): ReadonlyArray<EntryFieldView> {
  const specs = TOOL_FIELDS[session.tool] ?? [];
  const live = liveValues(session);
  const locks = liveLocks(session);
  // An arc types its radius and start angle first, then only its sweep.
  const placingEnd = arcPlacingEnd(session);
  return specs
    .filter((spec) => session.tool !== 'arc' || (spec.key === 'sweep') === placingEnd)
    .map((spec) => ({
      ...spec,
      value: live === null ? null : (live[spec.key] ?? null),
      locked: locks?.[spec.lock] !== undefined,
    }));
}

/** The value a locked box shows: the lock itself, in the box's own terms. */
export function lockedFieldValue(session: DesignSession, field: EntryFieldView): number | null {
  const locked = liveLocks(session)?.[field.lock];
  if (locked === undefined) return null;
  return field.key === 'diameter' ? locked * 2 : locked;
}

/**
 * Reads one box and writes (or clears) its lock on the live gesture. Returns the
 * parse so the box can show why a value was refused; an invalid entry changes
 * nothing.
 */
export function typeEntryField(field: EntryFieldView, text: string): EntryParse {
  const parsed = parseEntryValue(field.lock, text);
  if (parsed.kind === 'invalid') return parsed;
  const value =
    parsed.kind === 'clear' ? null : field.key === 'diameter' ? parsed.value / 2 : parsed.value;
  setLiveLocks((locks) => withEntryLock(locks, field.lock, value));
  return parsed;
}

/**
 * Enter: finish the step the typed values describe. A draft commits its shape;
 * a polyline places its next corner (or, with nothing typed, ends open — the
 * AutoCAD convention); an arc places its start or its end.
 */
export function completeEntryStep(newEntityId: () => string): void {
  const store = useDesignStudioStore.getState();
  const session = store.session;
  if (session === null) return;
  if (session.draft !== null) {
    store.commitDraft(newEntityId());
    return;
  }
  const sequence = session.pointSequence;
  if (sequence === null) return;
  if (sequence.kind === 'path' && sequence.locks === undefined && sequence.points.length >= 2) {
    const entity = finishOpenPath(sequence, newEntityId());
    if (entity !== null) store.commitPointEntity(entity);
    return;
  }
  handlePointToolClick(sequence.pointerMm, session, session.view?.pxPerMm ?? 1, newEntityId);
}

function liveLocks(session: DesignSession): EntryLocks | undefined {
  return session.draft?.locks ?? session.pointSequence?.locks;
}

function setLiveLocks(change: (locks: EntryLocks | undefined) => EntryLocks): void {
  const store = useDesignStudioStore.getState();
  const session = store.session;
  if (session === null) return;
  if (session.draft !== null) {
    store.setDraft({ ...session.draft, locks: change(session.draft.locks) });
    return;
  }
  if (session.pointSequence !== null) {
    store.setPointSequence({
      ...session.pointSequence,
      locks: change(session.pointSequence.locks),
    });
  }
}

function arcPlacingEnd(session: DesignSession): boolean {
  const sequence = session.pointSequence;
  return sequence?.kind === 'arc' && sequence.startMm !== null;
}

type LiveValues = Partial<Record<EntryFieldKey, number>>;

function liveValues(session: DesignSession): LiveValues | null {
  if (session.draft !== null) return draftValues(session.draft);
  const sequence = session.pointSequence;
  if (sequence === null) return null;
  return sequence.kind === 'path' ? pathValues(sequence) : arcValues(sequence);
}

function draftValues(draft: DesignDraft): LiveValues {
  switch (draft.tool) {
    case 'line':
      return { length: draftLengthMm(draft), angle: draftAngleDeg(draft) };
    case 'rect': {
      const rect = draftRectMm(draft);
      return { width: rect.widthMm, height: rect.heightMm };
    }
    case 'circle': {
      const radius = circleRadiusMm(draft);
      return { radius, diameter: radius * 2 };
    }
  }
}

function pathValues(sequence: PathPointSequence): LiveValues {
  const last = sequence.points[sequence.points.length - 1];
  if (last === undefined) return {};
  const target = lockedPathTarget(sequence, sequence.pointerMm);
  return { length: distance(last, target), angle: angleOf(last, target) };
}

function arcValues(sequence: ArcPointSequence): LiveValues {
  const target = lockedArcTarget(sequence, sequence.pointerMm);
  const start = sequence.startMm;
  if (start === null) {
    const radius = distance(sequence.centerMm, target);
    return { radius, diameter: radius * 2, angle: angleOf(sequence.centerMm, target) };
  }
  const sweep = angleOf(sequence.centerMm, target) - angleOf(sequence.centerMm, start);
  return { sweep: ((sweep % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG };
}

function angleOf(from: Vec2, to: Vec2): number {
  const deg = Math.atan2(to.y - from.y, to.x - from.x) * RAD_TO_DEG;
  return deg < 0 ? deg + FULL_TURN_DEG : deg;
}
