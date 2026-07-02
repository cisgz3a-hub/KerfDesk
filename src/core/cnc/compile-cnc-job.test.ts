import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import type { CncGroup } from '../job';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in bit (3.175 mm)

function squareObject(id: string, color: string, size: number, at = 50): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: at },
              { x: at + size, y: at },
              { x: at + size, y: at + size },
              { x: at, y: at + size },
            ],
          },
        ],
      },
    ],
  };
}

function cncLayer(id: string, color: string, cnc: Partial<CncLayerSettings>): Layer {
  return { ...createLayer({ id, color }), cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc } };
}

function sceneWith(layers: Layer[], objects: ImportedSvg[]): Scene {
  return { objects, layers };
}

function onlyGroup(scene: Scene): CncGroup {
  const job = compileCncJob(scene, dev, config);
  expect(job.groups).toHaveLength(1);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
  return group;
}

describe('compileCncJob', () => {
  it('expands depth passes shallow to deep with an exact floor', () => {
    const scene = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'profile-on-path', depthMm: 3, depthPerPassMm: 1.5 })],
      [squareObject('O1', '#ff0000', 20)],
    );
    const group = onlyGroup(scene);
    expect(group.passes.map((pass) => pass.zMm)).toEqual([-1.5, -3]);
    expect(group.passes.every((pass) => pass.closed)).toBe(true);
  });

  it('closes rings: every closed pass polyline ends at its start', () => {
    const scene = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'profile-outside', depthMm: 2, depthPerPassMm: 2 })],
      [squareObject('O1', '#ff0000', 20)],
    );
    const group = onlyGroup(scene);
    for (const pass of group.passes) {
      const first = pass.polyline[0];
      const last = pass.polyline[pass.polyline.length - 1];
      expect(first).toEqual(last);
    }
  });

  it('splits deep profile passes into tab segments', () => {
    const scene = sceneWith(
      [
        cncLayer('L1', '#ff0000', {
          cutType: 'profile-outside',
          depthMm: 6,
          depthPerPassMm: 2,
          tabsEnabled: true,
          tabHeightMm: 2,
          tabWidthMm: 6,
          tabsPerShape: 4,
        }),
      ],
      [squareObject('O1', '#ff0000', 40)],
    );
    const group = onlyGroup(scene);
    // Tab top sits at -(6-2) = -4: passes at -2 and -4 cut full loops,
    // the -6 pass splits into 4 open segments between tabs.
    const fullLoops = group.passes.filter((pass) => pass.closed);
    const tabbed = group.passes.filter((pass) => !pass.closed);
    expect(fullLoops).toHaveLength(2);
    expect(tabbed).toHaveLength(4);
    expect(new Set(tabbed.map((pass) => pass.zMm))).toEqual(new Set([-6]));
  });

  it('orders pocket groups before profile groups', () => {
    const scene = sceneWith(
      [
        cncLayer('profile', '#ff0000', { cutType: 'profile-outside' }),
        cncLayer('pocket', '#00ff00', { cutType: 'pocket' }),
      ],
      [squareObject('O1', '#ff0000', 30, 40), squareObject('O2', '#00ff00', 30, 120)],
    );
    const job = compileCncJob(scene, dev, config);
    expect(job.groups.map((group) => group.layerId)).toEqual(['pocket', 'profile']);
  });

  it('caps feeds to the device and spindle to the machine max', () => {
    const scene = sceneWith(
      [
        cncLayer('L1', '#ff0000', {
          feedMmPerMin: 999999,
          plungeMmPerMin: 999999,
          spindleRpm: 999999,
        }),
      ],
      [squareObject('O1', '#ff0000', 20)],
    );
    const group = onlyGroup(scene);
    expect(group.feedMmPerMin).toBe(dev.maxFeed);
    expect(group.plungeMmPerMin).toBe(dev.maxFeed);
    expect(group.spindleRpm).toBe(config.params.spindleMaxRpm);
  });

  it('skips layers with output disabled and layers without geometry', () => {
    const off = { ...cncLayer('off', '#ff0000', {}), output: false };
    const empty = cncLayer('empty', '#0000ff', {});
    const scene = sceneWith([off, empty], [squareObject('O1', '#ff0000', 20)]);
    expect(compileCncJob(scene, dev, config).groups).toHaveLength(0);
  });

  it('is deterministic', () => {
    const scene = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'pocket' })],
      [squareObject('O1', '#ff0000', 25)],
    );
    expect(compileCncJob(scene, dev, config)).toEqual(compileCncJob(scene, dev, config));
  });
});
