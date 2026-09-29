// ADR-258 Amendment 4: Job Review reads which operations cut holding tabs from
// the compiled passes. Pinned against the real compiler, so a tab wall is still
// found through leads and ramp entries, and nothing else reads as one.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { tabbedProfileLayerIds } from './compiled-tab-rises';

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 50, y: 50 },
    { x: 90, y: 50 },
    { x: 90, y: 90 },
    { x: 50, y: 90 },
  ],
};

const OPEN_LINE: Polyline = {
  closed: false,
  points: [
    { x: 50, y: 70 },
    { x: 90, y: 70 },
  ],
};

const THROUGH: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  cutType: 'profile-outside',
  depthMm: 6.5,
  depthPerPassMm: 2,
  tabsEnabled: true,
};

function tabbedLayers(
  patch: Partial<CncLayerSettings>,
  polyline: Polyline = SQUARE,
): ReadonlySet<string> {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...THROUGH, ...patch },
  };
  const artwork: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: 50, minY: 50, maxX: 90, maxY: 90 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [polyline] }],
  };
  const stock = { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 6 };
  const job = compileCncJob({ objects: [artwork], layers: [layer] }, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    stock,
  });
  return tabbedProfileLayerIds(job);
}

describe('tabbedProfileLayerIds', () => {
  it('finds the tab walls of a tabbed profile, with or without leads and ramps', () => {
    expect(tabbedLayers({})).toEqual(new Set(['L1']));
    expect(tabbedLayers({ profileLead: { shape: 'none' } })).toEqual(new Set(['L1']));
    expect(tabbedLayers({ rampEntryDeg: 5 })).toEqual(new Set(['L1']));
    expect(tabbedLayers({ cutType: 'profile-on-path' })).toEqual(new Set(['L1']));
  });

  it('finds none where no pass rises into a tab', () => {
    expect(tabbedLayers({ tabsEnabled: false })).toEqual(new Set());
    expect(tabbedLayers({ tabsEnabled: false, rampEntryDeg: 5 })).toEqual(new Set());
    // A floor that holds the part skips the tabs (ADR-258 amendment 1).
    expect(tabbedLayers({ depthMm: 2 })).toEqual(new Set());
    // An open path never takes a tab, ramped or not.
    const onPath = { cutType: 'profile-on-path' as const };
    expect(tabbedLayers(onPath, OPEN_LINE)).toEqual(new Set());
    expect(tabbedLayers({ ...onPath, rampEntryDeg: 5 }, OPEN_LINE)).toEqual(new Set());
    // A pocket takes no tabs.
    expect(tabbedLayers({ cutType: 'pocket' })).toEqual(new Set());
  });
});
