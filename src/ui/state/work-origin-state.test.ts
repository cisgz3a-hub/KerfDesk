// The origin a connection finds on the controller instead of setting it
// (controller audit 2, M-4, ADR-375). Only the first accepted work-offset
// report of a connection records it; it stops counting once an origin action
// or a different reported offset replaces it.

import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { statusPositionPatch } from './laser-status-position';
import type { WorkCoordinateOffset } from './origin-actions';
import { isRestoredWorkOrigin } from './work-origin-state';

const STORED: WorkCoordinateOffset = { x: 25, y: 15, z: 0 };

function report(wco: WorkCoordinateOffset): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    wco,
    feed: 0,
    spindle: 0,
  };
}

// As connectingStatePatch leaves a new connection: no origin, no offset yet.
function newConnection() {
  const harness = makeLineHandlerHarness();
  harness.set({
    connectionAttempt: 1,
    workOriginActive: false,
    workOriginSource: 'none',
    workOriginVersion: 3,
    wcoCache: null,
  });
  return harness;
}

describe('isRestoredWorkOrigin', () => {
  it('names the origin the first report shows, also when a reset re-learns it', () => {
    const { get, set } = newConnection();
    set(statusPositionPatch(get(), report(STORED)));
    expect(get().workOriginSource).toBe('unknown');
    expect(isRestoredWorkOrigin(get())).toBe(true);

    // A reset forgets the origin (originUnknownAfterControllerReset); grblHAL
    // kept it, so the next report brings the same one back.
    set({ workOriginActive: false, workOriginSource: 'none', wcoCache: null });
    expect(isRestoredWorkOrigin(get())).toBe(false);
    set(statusPositionPatch(get(), report(STORED)));
    expect(isRestoredWorkOrigin(get())).toBe(true);
  });

  it('does not name an origin set before the first report, nor one set later', () => {
    const setFirst = newConnection();
    setFirst.set({ workOriginActive: true, workOriginSource: 'g92', workOriginVersion: 4 });
    setFirst.set(statusPositionPatch(setFirst.get(), report(STORED)));
    expect(isRestoredWorkOrigin(setFirst.get())).toBe(false);

    const noneFirst = newConnection();
    noneFirst.set(statusPositionPatch(noneFirst.get(), report({ x: 0, y: 0, z: 0 })));
    noneFirst.set(statusPositionPatch(noneFirst.get(), report(STORED)));
    expect(noneFirst.get().workOriginActive).toBe(true);
    expect(isRestoredWorkOrigin(noneFirst.get())).toBe(false);
  });

  it('stops naming it after an origin action or a different reported offset', () => {
    const action = newConnection();
    action.set(statusPositionPatch(action.get(), report(STORED)));
    action.set({ workOriginVersion: 4 });
    expect(isRestoredWorkOrigin(action.get())).toBe(false);

    // A Console G92 elsewhere: console-state-effect forgets the origin and
    // the next report shows the new offset.
    const console = newConnection();
    console.set(statusPositionPatch(console.get(), report(STORED)));
    console.set({ workOriginActive: false, workOriginSource: 'none', wcoCache: null });
    console.set(statusPositionPatch(console.get(), report({ x: 40, y: 15, z: 0 })));
    expect(console.get().workOriginActive).toBe(true);
    expect(isRestoredWorkOrigin(console.get())).toBe(false);
  });

  it('leaves the next connection to its own first report', () => {
    const { get, set } = newConnection();
    set(statusPositionPatch(get(), report(STORED)));
    // A new connect attempt; its connecting patch forgets the origin.
    set({ connectionAttempt: 2 });
    expect(isRestoredWorkOrigin(get())).toBe(false);
    set({ workOriginActive: false, workOriginSource: 'none', wcoCache: null });
    set(statusPositionPatch(get(), report(STORED)));
    expect(isRestoredWorkOrigin(get())).toBe(true);
  });
});
