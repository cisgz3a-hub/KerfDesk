import { describe, expect, it } from 'vitest';
import { liveViewerState, type LiveRunSnapshot } from './viewer3d-live-run';

const LIFECYCLES = [
  'running',
  'paused',
  'tool-change',
  'stopped',
  'disconnected',
  'errored',
  'finished',
] as const;

function run(overrides?: Partial<LiveRunSnapshot>): LiveRunSnapshot {
  return {
    lifecycle: 'running',
    reportedHead: { x: 10, y: 20, z: -1.5 },
    route: { confirmedRouteMm: 42 },
    reportedFeedMmPerMin: 900,
    reportedSpindleRpm: 18000,
    ...overrides,
  };
}

describe('liveViewerState', () => {
  it('shows the design rather than a run when nothing is streaming', () => {
    expect(liveViewerState(null)).toBeNull();
  });

  it('places the cutter where the controller says the head is', () => {
    expect(liveViewerState(run())?.headMm).toEqual({ x: 10, y: 20, z: -1.5 });
  });

  it('reveals to the CONFIRMED length, not the sent length', () => {
    // The send-ahead buffer means the controller has accepted more than it has
    // executed; revealing to the sent length would draw cuts that have not
    // happened yet.
    expect(liveViewerState(run())?.revealMm).toBe(42);
  });

  it('draws no cutter rather than one at the origin before the first report', () => {
    // A head at 0,0,0 is a real machine position, so it cannot double as
    // "unknown" — the operator would read a parked bit as a homed one.
    expect(liveViewerState(run({ reportedHead: null }))?.headMm).toBeNull();
  });

  it('suppresses feed and spindle unless the run is actually running', () => {
    // Matches feedBadgeText in canvas-motion-badge.tsx: a held or finished run
    // reports 0 and a stopped run's last sample is stale.
    for (const lifecycle of LIFECYCLES) {
      const state = liveViewerState(run({ lifecycle }));
      if (lifecycle === 'running') {
        expect(state?.feedMmPerMin).toBe(900);
        expect(state?.spindleRpm).toBe(18000);
      } else {
        expect(state?.feedMmPerMin).toBeNull();
        expect(state?.spindleRpm).toBeNull();
      }
    }
  });

  it('keeps reporting head and reveal after the run stops', () => {
    // Position is still true when a run halts — it is where the bit actually
    // is. Only the RATE readings go stale, which is why only they are cleared.
    const state = liveViewerState(run({ lifecycle: 'stopped' }));
    expect(state?.headMm).toEqual({ x: 10, y: 20, z: -1.5 });
    expect(state?.revealMm).toBe(42);
  });

  it('passes a missing feed sample through as null rather than zero', () => {
    // Zero mm/min is a real reading (a hold); "no FS: field in the status
    // frame" is not, and conflating them would show a stopped feed on a
    // controller that simply does not report one.
    expect(liveViewerState(run({ reportedFeedMmPerMin: null }))?.feedMmPerMin).toBeNull();
  });
});
