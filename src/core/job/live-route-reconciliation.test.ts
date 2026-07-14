import { describe, expect, it } from 'vitest';
import { buildMotionManifest } from './motion-manifest';
import {
  INITIAL_ROUTE_RECONCILIATION,
  reconcileReportedPosition,
} from './live-route-reconciliation';

const manifest = buildMotionManifest('G21\nG90\nM3 S0\nG0 X0 Y0\nG1 X10 S500\nG1 X20\nG1 X10', {
  machineKind: 'laser',
});

describe('reconcileReportedPosition', () => {
  it('does not advance from acknowledgements alone', () => {
    expect(INITIAL_ROUTE_RECONCILIATION.confirmedRouteMm).toBe(0);
  });

  it('starts candidate scanning near confirmed progress instead of rescanning the route prefix', () => {
    const longManifest = buildMotionManifest(
      ['G21', 'G90', 'M3 S500', ...Array.from({ length: 2_000 }, (_, i) => `G1 X${i + 1}`)].join(
        '\n',
      ),
      { machineKind: 'laser' },
    );
    const protectedPrefix = longManifest.blocks.map((block, index, blocks) =>
      index < blocks.length - 20
        ? new Proxy(block, {
            get(target, property, receiver) {
              if (property === 'points') throw new Error('confirmed route prefix was rescanned');
              return Reflect.get(target, property, receiver);
            },
          })
        : block,
    );
    const result = reconcileReportedPosition({
      manifest: { ...longManifest, blocks: protectedPrefix },
      previous: {
        confirmedRouteMm: longManifest.totalRouteMm - 5,
        candidates: [],
        uncertain: false,
      },
      reportedPosition: { x: 1_998, y: 0, z: 0 },
      acceptedSendableLines: 3_000,
    });
    expect(result.uncertain).toBe(false);
    expect(result.confirmedRouteMm).toBeGreaterThanOrEqual(longManifest.totalRouteMm - 5);
  });

  it('advances only from a reported position under the accepted-line ceiling', () => {
    const blocked = reconcileReportedPosition({
      manifest,
      previous: INITIAL_ROUTE_RECONCILIATION,
      reportedPosition: { x: 15, y: 0, z: 0 },
      acceptedSendableLines: 5,
    });
    expect(blocked.uncertain).toBe(true);
    const accepted = reconcileReportedPosition({
      manifest,
      previous: INITIAL_ROUTE_RECONCILIATION,
      reportedPosition: { x: 15, y: 0, z: 0 },
      acceptedSendableLines: 6,
    });
    expect(accepted.confirmedRouteMm).toBeCloseTo(15);
  });

  it('takes the common prefix at a repeated coordinate instead of jumping ahead', () => {
    const state = reconcileReportedPosition({
      manifest,
      previous: INITIAL_ROUTE_RECONCILIATION,
      reportedPosition: { x: 10, y: 0, z: 0 },
      acceptedSendableLines: manifest.sendableLineCount,
    });
    expect(state.candidates.length).toBeGreaterThan(1);
    expect(state.confirmedRouteMm).toBeCloseTo(10);
  });

  it('freezes and marks uncertain for an out-of-route report', () => {
    const previous = { confirmedRouteMm: 8, candidates: [], uncertain: false };
    const state = reconcileReportedPosition({
      manifest,
      previous,
      reportedPosition: { x: 50, y: 50, z: 0 },
      acceptedSendableLines: manifest.sendableLineCount,
    });
    expect(state.confirmedRouteMm).toBe(8);
    expect(state.uncertain).toBe(true);
  });

  it('uses optional N/Ln values as an additional executing-line bound', () => {
    const numbered = buildMotionManifest('N10 G21\nN20 G90\nN30 M3 S500\nN40 G1 X10\nN50 G1 X20', {
      machineKind: 'laser',
    });
    const blocked = reconcileReportedPosition({
      manifest: numbered,
      previous: INITIAL_ROUTE_RECONCILIATION,
      reportedPosition: { x: 15, y: 0, z: 0 },
      acceptedSendableLines: numbered.sendableLineCount,
      executingLineNumber: 40,
    });
    expect(blocked.uncertain).toBe(true);
    const accepted = reconcileReportedPosition({
      manifest: numbered,
      previous: INITIAL_ROUTE_RECONCILIATION,
      reportedPosition: { x: 15, y: 0, z: 0 },
      acceptedSendableLines: numbered.sendableLineCount,
      executingLineNumber: 50,
    });
    expect(accepted.confirmedRouteMm).toBeCloseTo(15);
  });
});
