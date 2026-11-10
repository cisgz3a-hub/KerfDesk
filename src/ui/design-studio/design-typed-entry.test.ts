import { beforeEach, describe, expect, it } from 'vitest';
import type {
  SketchArc,
  SketchCircle,
  SketchLine,
  SketchPath,
  SketchRectangle,
} from '../../core/design';
import { NO_MODIFIERS, type DraftTool } from './design-draft';
import { beginArcSequence, beginPathSequence } from './design-point-sequence';
import { useDesignStudioStore } from './design-studio-store';
import {
  completeEntryStep,
  entryFieldsFor,
  isEntryGestureLive,
  typeEntryField,
  type EntryFieldKey,
} from './design-typed-entry';

const store = (): ReturnType<typeof useDesignStudioStore.getState> =>
  useDesignStudioStore.getState();

const session = () => {
  const current = store().session;
  if (current === null) throw new Error('expected an open session');
  return current;
};

let ids = 0;
const nextId = (): string => `typed-${++ids}`;

function startDraft(tool: DraftTool, pointerMm = { x: 13, y: 24 }): void {
  store().setTool(tool);
  store().setDraft({ tool, anchorMm: { x: 10, y: 20 }, pointerMm, modifiers: NO_MODIFIERS });
}

function type(key: EntryFieldKey, text: string): void {
  const field = entryFieldsFor(session()).find((candidate) => candidate.key === key);
  if (field === undefined) throw new Error(`no ${key} box`);
  expect(typeEntryField(field, text).kind).not.toBe('invalid');
}

function lastEntity() {
  const entities = session().history.present.entities;
  return entities[entities.length - 1];
}

beforeEach(() => {
  useDesignStudioStore.setState({ session: null, stash: null });
  void store().openStudio();
});

describe('typed entry boxes', () => {
  it('names the quantities each draw tool takes, idle until a gesture starts', () => {
    store().setTool('line');
    const idle = entryFieldsFor(session());
    expect(idle.map((field) => field.key)).toEqual(['length', 'angle']);
    expect(idle.every((field) => field.value === null)).toBe(true);
    expect(isEntryGestureLive(session())).toBe(false);
    store().setTool('rect');
    expect(entryFieldsFor(session()).map((field) => field.key)).toEqual(['width', 'height']);
    store().setTool('circle');
    expect(entryFieldsFor(session()).map((field) => field.key)).toEqual(['radius', 'diameter']);
    store().setTool('fillet');
    expect(entryFieldsFor(session())).toEqual([]);
  });

  it('tracks the live gesture until a value is typed', () => {
    startDraft('line', { x: 13, y: 24 });
    const length = entryFieldsFor(session()).find((field) => field.key === 'length');
    expect(length?.value).toBeCloseTo(5, 9);
    expect(length?.locked).toBe(false);
  });
});

describe('typing a draft', () => {
  it('locks a line length and keeps the pointer direction', () => {
    startDraft('line');
    type('length', '50');
    completeEntryStep(nextId);
    const line = lastEntity() as SketchLine;
    expect(line.end.x).toBeCloseTo(40, 9);
    expect(line.end.y).toBeCloseTo(60, 9);
    expect(session().draft).toBeNull();
  });

  it('fixes a line completely from a typed length and angle', () => {
    startDraft('line', { x: -300, y: 4 });
    type('length', '1in');
    type('angle', '90');
    completeEntryStep(nextId);
    const line = lastEntity() as SketchLine;
    expect(line.end.x).toBeCloseTo(10, 9);
    expect(line.end.y).toBeCloseTo(45.4, 9);
  });

  it('draws a rectangle from a click and two typed sizes, toward the pointer side', () => {
    startDraft('rect', { x: 10, y: 20 });
    store().commitDraft(nextId());
    expect(session().draft?.released).toBe(true);
    store().setDraft({ ...session().draft!, pointerMm: { x: 0, y: 30 } });
    type('width', '40');
    type('height', '25');
    completeEntryStep(nextId);
    const rect = lastEntity() as SketchRectangle;
    expect(rect.origin).toEqual({ x: -30, y: 20 });
    expect(rect.widthMm).toBe(40);
    expect(rect.heightMm).toBe(25);
  });

  it('reads a typed size as the whole width when drawing from the centre', () => {
    store().setTool('rect');
    store().setDraft({
      tool: 'rect',
      anchorMm: { x: 0, y: 0 },
      pointerMm: { x: 1, y: 1 },
      modifiers: { constrain: false, fromCentre: true },
    });
    type('width', '40');
    type('height', '10');
    completeEntryStep(nextId);
    const rect = lastEntity() as SketchRectangle;
    expect(rect.origin).toEqual({ x: -20, y: -5 });
    expect(rect.widthMm).toBe(40);
  });

  it('turns a typed diameter into the radius', () => {
    startDraft('circle');
    type('diameter', '30');
    completeEntryStep(nextId);
    expect((lastEntity() as SketchCircle).radiusMm).toBe(15);
  });

  it('releases a lock when the box is emptied', () => {
    startDraft('line');
    type('length', '50');
    type('length', '');
    expect(session().draft?.locks).toEqual({});
  });

  it('refuses a size that draws nothing and leaves the gesture alone', () => {
    startDraft('circle');
    const radius = entryFieldsFor(session())[0]!;
    expect(typeEntryField(radius, '0').kind).toBe('invalid');
    expect(session().draft?.locks).toBeUndefined();
  });

  it('drops every lock with the gesture on a tool switch', () => {
    startDraft('line');
    type('length', '50');
    store().setTool('rect');
    expect(session().draft).toBeNull();
  });
});

describe('typing a click sequence', () => {
  it('places each polyline corner from a typed length and angle, fresh per segment', () => {
    store().setTool('path');
    store().setPointSequence({ ...beginPathSequence({ x: 0, y: 0 }), pointerMm: { x: 5, y: 1 } });
    type('length', '20');
    type('angle', '0');
    completeEntryStep(nextId);
    const after = session().pointSequence;
    expect(after?.kind === 'path' ? after.points : []).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(after?.locks).toBeUndefined();
    // Enter with nothing typed ends the polyline open, as AutoCAD does.
    completeEntryStep(nextId);
    expect((lastEntity() as SketchPath).points).toHaveLength(2);
    expect(session().pointSequence).toBeNull();
  });

  it('places an arc start from a typed radius and angle, then its end from a sweep', () => {
    store().setTool('arc');
    store().setPointSequence({ ...beginArcSequence({ x: 0, y: 0 }), pointerMm: { x: 3, y: 3 } });
    type('radius', '10');
    type('angle', '0');
    completeEntryStep(nextId);
    expect(entryFieldsFor(session()).map((field) => field.key)).toEqual(['sweep']);
    type('sweep', '90');
    completeEntryStep(nextId);
    const arc = lastEntity() as SketchArc;
    expect(arc.radiusMm).toBeCloseTo(10, 9);
    expect(arc.startAngleDeg).toBeCloseTo(0, 9);
    expect(arc.sweepDeg).toBeCloseTo(90, 9);
  });
});
