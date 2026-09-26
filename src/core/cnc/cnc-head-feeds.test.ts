import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncMachineConfig,
  type Scene,
} from '../scene';
import {
  cncHeadDevice,
  cncMachineWithOwnFeeds,
  cncMaxFeedMmPerMin,
  deviceForActiveHead,
} from './cnc-head-feeds';
import { compileCncJob } from './compile-cnc-job';

const laserDevice = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 9000, framingFeedMmPerMin: 7000 };
const ownFeeds: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  params: {
    ...DEFAULT_CNC_MACHINE_CONFIG.params,
    maxFeedMmPerMin: 1800,
    framingFeedMmPerMin: 1200,
  },
};

function fastSquareScene(): Scene {
  const color = '#ff0000';
  return {
    layers: [
      {
        ...createLayer({ id: 'cut', color }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: false, feedMmPerMin: 50_000 },
      },
    ],
    objects: [
      {
        kind: 'imported-svg',
        id: 'square',
        source: 'square.svg',
        bounds: { minX: 50, minY: 50, maxX: 70, maxY: 70 },
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color,
            polylines: [
              {
                closed: true,
                points: [
                  { x: 50, y: 50 },
                  { x: 70, y: 50 },
                  { x: 70, y: 70 },
                  { x: 50, y: 70 },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function compiledFeed(device: typeof laserDevice, machine: CncMachineConfig): number | undefined {
  const group = compileCncJob(fastSquareScene(), device, machine).groups[0];
  return group?.kind === 'cnc' ? group.feedMmPerMin : undefined;
}

describe('CNC keeps its own Max feed and Frame speed', () => {
  it('caps CNC cuts at the CNC Max feed, not the laser one', () => {
    expect(compiledFeed(laserDevice, ownFeeds)).toBe(1800);
  });

  it('leaves CNC output unchanged when the laser Max feed changes', () => {
    const slowerLaser = { ...laserDevice, maxFeed: 600 };
    expect(compiledFeed(slowerLaser, ownFeeds)).toBe(compiledFeed(laserDevice, ownFeeds));
  });

  it('falls back to the shared device values for a CNC setup saved before the split', () => {
    expect(cncMaxFeedMmPerMin(laserDevice, DEFAULT_CNC_MACHINE_CONFIG.params)).toBe(9000);
    expect(compiledFeed(laserDevice, DEFAULT_CNC_MACHINE_CONFIG)).toBe(9000);
  });

  it('shows each head its own speeds and shares everything else', () => {
    const cnc = deviceForActiveHead(laserDevice, ownFeeds);
    expect(cnc).toMatchObject({ maxFeed: 1800, framingFeedMmPerMin: 1200 });
    expect(cnc.bedWidth).toBe(laserDevice.bedWidth);
    expect(deviceForActiveHead(laserDevice, { kind: 'laser' })).toBe(laserDevice);
    expect(cncHeadDevice(laserDevice, DEFAULT_CNC_MACHINE_CONFIG.params)).toBe(laserDevice);
  });

  it('freezes the current values on a CNC setup that has none, and keeps set ones', () => {
    const seeded = cncMachineWithOwnFeeds(DEFAULT_CNC_MACHINE_CONFIG, laserDevice);
    expect(seeded.params).toMatchObject({ maxFeedMmPerMin: 9000, framingFeedMmPerMin: 7000 });
    expect(cncMachineWithOwnFeeds(ownFeeds, laserDevice)).toBe(ownFeeds);
  });
});
