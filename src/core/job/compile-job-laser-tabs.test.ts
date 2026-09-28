import { describe, expect, it } from 'vitest';
import { planRdMotion } from '../controllers/ruida/rd-motion-plan';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { marlinStrategy } from '../output/marlin-strategy';
import { smoothiewareStrategy } from '../output/smoothieware-strategy';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type LayerOperationSettings,
  type SceneObject,
} from '../scene';
import type { LaserTabAnchor } from '../scene/scene-object';
import { compileJob } from './compile-job';
import { estimateJobDuration } from './estimate-duration';
import type { CutGroup, Job } from './job';
import { optimizePaths } from './optimize-paths';
import { buildToolpath } from './toolpath';

const DEVICE = DEFAULT_DEVICE_PROFILE;
const TABS: Partial<LayerOperationSettings> = {
  tabsEnabled: true,
  tabSizeMm: 2,
  tabsPerShape: 4,
  power: 50,
};

function squareObject(
  id: string,
  x: number,
  size = 10,
  color = '#ff0000',
  laserTabAnchors?: ReadonlyArray<LaserTabAnchor>,
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 10, maxX: x + size, maxY: 10 + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 10 },
              { x: x + size, y: 10 },
              { x: x + size, y: 10 + size },
              { x, y: 10 + size },
            ],
          },
        ],
      },
    ],
    ...(laserTabAnchors === undefined ? {} : { laserTabAnchors }),
  };
}

function layerWith(settings: Partial<LayerOperationSettings>, id = 'L1', color = '#ff0000'): Layer {
  return { ...createLayer({ id, color }), ...settings };
}

function compileWith(
  settings: Partial<LayerOperationSettings>,
  objects: ReadonlyArray<SceneObject> = [squareObject('square', 10)],
): Job {
  return compileJob({ objects, layers: [layerWith(settings)] }, DEVICE);
}

function cutGroups(job: Job): ReadonlyArray<CutGroup> {
  return job.groups.flatMap((group) => (group.kind === 'cut' ? [group] : []));
}

function anchor(pathT: number): LaserTabAnchor {
  return { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT };
}

describe('laser tab power (ADR-494)', () => {
  it('compiles byte-identically with the new settings at their defaults', () => {
    const baseline = compileWith(TABS);
    const explicit = compileWith({
      ...TABS,
      tabLayout: 'count',
      tabSpacingMm: 30,
      tabMaxPerShape: 3,
      tabCutPowerPercent: 0,
    });
    expect(explicit).toEqual(baseline);
    expect(grblStrategy.emit(explicit, DEVICE)).toBe(grblStrategy.emit(baseline, DEVICE));
    expect(baseline.groups).toHaveLength(1);
  });

  it('burns the tab spans right after the cut at the tab share of its power', () => {
    const job = compileWith({ ...TABS, tabCutPowerPercent: 20, passes: 2, airAssist: true });
    const [cut, tabs] = cutGroups(job);
    expect(job.groups).toHaveLength(2);
    expect(cut?.power).toBe(50);
    expect(cut?.segments).toHaveLength(4);
    expect(cut).not.toHaveProperty('tabSpanPowerPercent');
    expect(tabs).toMatchObject({
      layerId: 'L1',
      power: 10,
      tabSpanPowerPercent: 20,
      speed: cut?.speed,
      passes: 2,
      airAssist: true,
    });
    expect(tabs?.segments).toHaveLength(4);
    expect(tabs?.segments.every((segment) => !segment.closed)).toBe(true);
  });

  it('emits the tab spans at the tab S value in GRBL', () => {
    const gcode = grblStrategy.emit(compileWith({ ...TABS, tabCutPowerPercent: 20 }), DEVICE);
    const [, tabSection] = gcode.split('tab spans at 20% of cut power');
    expect(tabSection).toBeDefined();
    const burns = (tabSection ?? '')
      .split('\n')
      .filter((line) => line.startsWith('G1 ') && / S[1-9]/.test(line));
    expect(burns.length).toBeGreaterThan(0);
    expect(burns.every((line) => line.includes('S100'))).toBe(true);
    const cutSection = gcode.split('tab spans at')[0] ?? '';
    expect(cutSection).toContain('S500');
    expect(cutSection).not.toContain('S100');
  });

  it.each([
    ['Marlin', (job: Job) => marlinStrategy.emit(job, DEVICE), 'S500', 'S100'],
    [
      'Smoothieware',
      (job: Job) => smoothiewareStrategy.emit(job, { ...DEVICE, maxPowerS: 1 }),
      'S0.5',
      'S0.1',
    ],
  ] as const)('emits the tab spans at the tab power in %s', (_name, emit, cutS, tabS) => {
    const gcode = emit(compileWith({ ...TABS, tabCutPowerPercent: 20 }));
    const [cutSection, tabSection] = gcode.split('tab spans at 20% of cut power');
    expect(cutSection).toContain(cutS);
    expect(tabSection).toContain(tabS);
    expect(tabSection).not.toContain(cutS);
  });

  it('shows the burned tabs in the preview route and adds their time to the estimates', () => {
    const uncut = compileWith(TABS);
    const burned = compileWith({ ...TABS, tabCutPowerPercent: 20 });
    const cutSteps = (job: Job) => buildToolpath(job).steps.filter((step) => step.kind === 'cut');
    expect(cutSteps(uncut)).toHaveLength(4);
    expect(cutSteps(burned)).toHaveLength(8);
    expect(estimateJobDuration(burned, DEVICE).totalSeconds).toBeGreaterThan(
      estimateJobDuration(uncut, DEVICE).totalSeconds,
    );
  });

  it('gives the tab spans their own Ruida part at the tab power', () => {
    const parts = planRdMotion(cutGroups(compileWith({ ...TABS, tabCutPowerPercent: 20 })));
    expect(parts.map((part) => part.group.power)).toEqual([50, 10]);
  });

  it('keeps the tab spans right after their cut when layer priority is reversed', () => {
    const red = squareObject('two-colour', 10);
    const blue = squareObject('blue', 40, 10, '#0000ff');
    const twoColour: SceneObject =
      'paths' in red && 'paths' in blue ? { ...red, paths: [...red.paths, ...blue.paths] } : red;
    const job = compileJob(
      {
        objects: [twoColour],
        layers: [
          layerWith({ ...TABS, tabCutPowerPercent: 20 }),
          layerWith({ power: 30 }, 'L2', '#0000ff'),
        ],
      },
      DEVICE,
    );
    const reversed = optimizePaths(job, {
      travelPolicy: 'source-order',
      insideFirst: true,
      layerPriority: 'reverse-project-order',
      pathDirection: 'allow-reverse',
      startPoint: 'machine-origin',
    });
    expect(cutGroups(reversed).map((group) => [group.layerId, group.power])).toEqual([
      ['L2', 30],
      ['L1', 50],
      ['L1', 10],
    ]);
  });
});

describe('laser tabs by spacing (ADR-494)', () => {
  it('gives each shape tabs for its own perimeter', () => {
    const job = compileWith({ ...TABS, tabLayout: 'spacing', tabSpacingMm: 10 }, [
      squareObject('small', 10),
      squareObject('large', 40, 30),
    ]);
    const segments = cutGroups(job).flatMap((group) => group.segments);
    // 4 tabs on the 40 mm outline, 12 on the 120 mm one.
    expect(segments).toHaveLength(16);
  });
});

describe('laser tabs placed by hand (ADR-494)', () => {
  it('replaces the automatic tabs on that artwork only', () => {
    const job = compileWith({ ...TABS, tabCutPowerPercent: 20 }, [
      squareObject('placed', 10, 10, '#ff0000', [anchor(0.125)]),
      squareObject('automatic', 40),
    ]);
    const [cut, tabs] = cutGroups(job);
    // Machine X equals scene X on the default profile: the placed square spans 10-20.
    const onPlaced = (group: CutGroup | undefined) =>
      (group?.segments ?? []).filter((segment) => (segment.polyline[0]?.x ?? 0) < 30).length;
    expect(cut?.segments).toHaveLength(5);
    expect(onPlaced(cut)).toBe(1);
    expect(tabs?.segments).toHaveLength(5);
    expect(onPlaced(tabs)).toBe(1);
  });

  it('places the tab where the anchor is, at the tab power', () => {
    const job = compileWith({ ...TABS, tabCutPowerPercent: 50 }, [
      squareObject('placed', 10, 10, '#ff0000', [anchor(0.125)]),
    ]);
    const tabs = cutGroups(job)[1];
    expect(tabs?.segments).toHaveLength(1);
    // pathT 0.125 is 5 mm along the 40 mm loop: the middle of its first edge.
    const span = tabs?.segments[0]?.polyline ?? [];
    expect(span).toHaveLength(2);
    const [first, last] = span;
    expect(first?.x).toBeCloseTo(14, 9);
    expect(last?.x).toBeCloseTo(16, 9);
    expect(first?.y).toBe(last?.y);
  });

  it('ignores placed tabs while tabs are off', () => {
    const objects = [squareObject('placed', 10, 10, '#ff0000', [anchor(0.125)])];
    expect(compileWith({ ...TABS, tabsEnabled: false }, objects)).toEqual(
      compileWith({ ...TABS, tabsEnabled: false }, [squareObject('placed', 10)]),
    );
  });

  it('ignores an anchor whose colour is no longer its path colour', () => {
    const stale: LaserTabAnchor = { ...anchor(0.125), layerColor: '#00ff00' };
    const job = compileWith(TABS, [squareObject('placed', 10, 10, '#ff0000', [stale])]);
    expect(cutGroups(job)[0]?.segments).toHaveLength(4);
  });

  it('carries placed tabs onto the kerf-offset contour', () => {
    const job = compileWith({ ...TABS, kerfOffsetMm: 0.5, tabCutPowerPercent: 20 }, [
      squareObject('placed', 10, 10, '#ff0000', [anchor(0.125), anchor(0.625)]),
    ]);
    const [cut, tabs] = cutGroups(job);
    expect(cut?.segments).toHaveLength(2);
    expect(tabs?.segments).toHaveLength(2);
  });
});
