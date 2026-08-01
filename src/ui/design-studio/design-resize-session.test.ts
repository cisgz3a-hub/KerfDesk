import { describe, expect, it } from 'vitest';

import type { SketchCircle } from '../../core/design';
import { resizeHandles, selectionBounds } from './design-handles';
import { beginSessionResize, endSessionResize, updateSessionResize } from './design-resize-session';
import { createDesignSession, sessionSketch, withSketch } from './design-session';

const circle: SketchCircle = { kind: 'circle', id: 'c', center: { x: 50, y: 50 }, radiusMm: 10 };

function selectedSession() {
  const base = withSketch(createDesignSession(), { entities: [circle] });
  return { ...base, selectedIds: new Set(['c']) };
}

function swGrip(session: ReturnType<typeof selectedSession>) {
  const handles = resizeHandles(selectionBounds(sessionSketch(session), session.selectedIds));
  const grip = handles.find((handle) => handle.corner === 'sw');
  if (grip === undefined) throw new Error('expected a south-west grip');
  return grip;
}

describe('the resize gesture', () => {
  it('scales the selection about the opposite corner', () => {
    const session = selectedSession();
    const grip = swGrip(session);
    // Bounds are 40..60 on both axes, so the anchor is (60, 60) and the grip
    // starts at (40, 40). Dragging it to (20, 20) doubles the span.
    const resizing = updateSessionResize(beginSessionResize(session, grip), { x: 20, y: 20 });
    const scaled = sessionSketch(resizing).entities[0];
    if (scaled?.kind !== 'circle') throw new Error('expected a circle');
    expect(scaled.radiusMm).toBeCloseTo(20, 6);
    // The held corner stayed put: the far edge is still at 60.
    expect(scaled.center.x + scaled.radiusMm).toBeCloseTo(60, 6);
  });

  it('does not compound across updates — the factor is always measured from the start', () => {
    const session = selectedSession();
    const grip = swGrip(session);
    const once = updateSessionResize(beginSessionResize(session, grip), { x: 20, y: 20 });
    const twice = updateSessionResize(once, { x: 20, y: 20 });
    const first = sessionSketch(once).entities[0];
    const second = sessionSketch(twice).entities[0];
    if (first?.kind !== 'circle' || second?.kind !== 'circle') throw new Error('expected circles');
    expect(second.radiusMm).toBeCloseTo(first.radiusMm, 9);
  });

  it('dragging back to the start restores the original geometry', () => {
    const session = selectedSession();
    const grip = swGrip(session);
    const out = updateSessionResize(beginSessionResize(session, grip), { x: 0, y: 0 });
    const back = updateSessionResize(out, grip.atMm);
    const restored = sessionSketch(back).entities[0];
    if (restored?.kind !== 'circle') throw new Error('expected a circle');
    expect(restored.radiusMm).toBeCloseTo(circle.radiusMm, 6);
    expect(restored.center.x).toBeCloseTo(circle.center.x, 6);
  });

  // The headline contract, shared with the move gesture: a whole drag is ONE
  // undo step, not one per pointer move.
  it('commits the whole drag as a single history step', () => {
    const session = selectedSession();
    const depthBefore = session.history.past.length;
    const grip = swGrip(session);
    let live = beginSessionResize(session, grip);
    live = updateSessionResize(live, { x: 35, y: 35 });
    live = updateSessionResize(live, { x: 30, y: 30 });
    live = updateSessionResize(live, { x: 25, y: 25 });
    const done = endSessionResize(live);
    expect(done.history.past.length).toBe(depthBefore + 1);
    expect(done.resize).toBeNull();
    expect(done.dirtySinceApply).toBe(true);
  });

  it('is inert without a selection or without a live gesture', () => {
    const empty = withSketch(createDesignSession(), { entities: [circle] });
    const grip = swGrip({ ...empty, selectedIds: new Set(['c']) });
    expect(beginSessionResize(empty, grip)).toBe(empty);
    expect(updateSessionResize(empty, { x: 0, y: 0 })).toBe(empty);
    expect(endSessionResize(empty)).toBe(empty);
  });
});
