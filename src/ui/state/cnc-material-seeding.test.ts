// New CNC layers inherit the project stock material's feeds (ADR-112 seeding):
// manual Add and SVG import both seed. Laser mode and "no material" are no-ops.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calculateFeeds } from '../../core/cnc';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

function hardwoodFeed(): number {
  const feeds = calculateFeeds({
    material: 'hardwood',
    bitDiameterMm: 3.175,
    flutes: 2,
    rpm: 12000,
  });
  if (feeds.kind === 'error') throw new Error(feeds.reason);
  return feeds.feedMmPerMin;
}

const HARDWOOD_FEED = hardwoodFeed();

beforeEach(() => {
  resetStore();
  useStore.getState().setMachineKind('cnc');
});
afterEach(() => resetStore());

function feedOf(color: string): number | undefined {
  return useStore.getState().project.scene.layers.find((l) => l.color === color)?.cnc?.feedMmPerMin;
}

describe('CNC project-material seeding (ADR-112)', () => {
  it('seeds a manually added layer from the project material', () => {
    useStore.getState().applyCncStockMaterial('hardwood');
    useStore.getState().createManualLayer('#00aa00');
    expect(feedOf('#00aa00')).toBe(HARDWOOD_FEED);
  });

  it('seeds fresh layers created by an SVG import', () => {
    useStore.getState().applyCncStockMaterial('hardwood');
    useStore.getState().importSvgObject(svgObj('logo', ['#112233']));
    expect(feedOf('#112233')).toBe(HARDWOOD_FEED);
  });

  it('adds no seeded cnc block when no project material is set', () => {
    useStore.getState().createManualLayer('#00aa00');
    // No material ⇒ no seeding ⇒ no cnc block; feeds fall back to
    // DEFAULT_CNC_LAYER_SETTINGS at read/compile time, byte-identical to before.
    expect(feedOf('#00aa00')).toBeUndefined();
  });

  it('does not seed in laser mode', () => {
    // A project material can't be set in laser mode (applyCncStockMaterial is a
    // no-op there), so imported layers keep laser defaults — sanity check.
    useStore.getState().setMachineKind('laser');
    useStore.getState().importSvgObject(svgObj('logo', ['#112233']));
    expect(feedOf('#112233')).toBeUndefined(); // laser layers have no cnc block seeded
  });
});
