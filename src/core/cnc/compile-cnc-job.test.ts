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
import type { CncContourPass, CncGroup, CncPass } from '../job';
import { cncGrblStrategy } from '../output';
import { compileCncJob } from './compile-cnc-job';

// compileCncJob only ever produces contour passes today (path3d arrives with
// relief finishing / ramps); tests narrow through this to read zMm/polyline.
function contourPass(pass: CncPass): CncContourPass {
  if (pass.kind !== 'contour') throw new Error('expected a contour pass');
  return pass;
}

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
  it('compiles verified adaptive roughing with native helix and cleanup contours', () => {
    const scene = sceneWith(
      [
        cncLayer('L1', '#ff0000', {
          cutType: 'pocket',
          pocketStrategy: 'adaptive',
          adaptiveOptimalLoadMm: 0.4,
          depthMm: 2,
          depthPerPassMm: 2,
        }),
      ],
      [squareObject('O1', '#ff0000', 20)],
    );
    const job = compileCncJob(scene, dev, config);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a CNC group');
    expect(group.passes[0]?.kind).toBe('helical-contour');
    expect(group.passes.some((pass) => pass.kind === 'contour')).toBe(true);
    const gcode = cncGrblStrategy.emit(job, dev);
    expect(gcode).toMatch(/^G3 .*I-.*J0\.000/m);
    expect(gcode).toBe(cncGrblStrategy.emit(compileCncJob(scene, dev, config), dev));
  });

  it('runs a larger pocket rougher before a smaller rest-machining bit', () => {
    const scene = sceneWith(
      [
        cncLayer('L1', '#ff0000', {
          cutType: 'pocket',
          toolId: 'em-1588',
          pocketRoughToolId: 'em-6350',
          depthMm: 2,
          depthPerPassMm: 2,
        }),
      ],
      [squareObject('O1', '#ff0000', 30)],
    );
    const job = compileCncJob(scene, dev, config);
    expect(job.groups).toHaveLength(2);
    const rough = job.groups[0];
    const rest = job.groups[1];
    if (rough?.kind !== 'cnc' || rest?.kind !== 'cnc') throw new Error('expected CNC groups');
    expect(rough.toolId).toBe('em-6350');
    expect(rest.toolId).toBe('em-1588');
    expect(rough.passes.length).toBeGreaterThan(rest.passes.length);
    expect(rest.passes.length).toBeGreaterThan(0);
    const gcode = cncGrblStrategy.emit(job, dev);
    expect(gcode.indexOf('tool 6.350 mm')).toBeLessThan(gcode.indexOf('tool 1.588 mm'));
    expect(gcode.match(/^M0$/gm)).toHaveLength(1);
  });

  it('compiles an opted-in offset pocket with native helical contour passes', () => {
    const scene = sceneWith(
      [
        cncLayer('L1', '#ff0000', {
          cutType: 'pocket',
          depthMm: 4,
          depthPerPassMm: 2,
          helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
        }),
      ],
      [squareObject('O1', '#ff0000', 20)],
    );
    const group = onlyGroup(scene);
    expect(group.passes.length).toBeGreaterThan(0);
    expect(group.passes.every((pass) => pass.kind === 'helical-contour')).toBe(true);
    expect(group.passes[0]).toMatchObject({ startZMm: 0, zMm: -2 });
    expect(group.passes.at(-1)).toMatchObject({ startZMm: -2, zMm: -4 });
    const firstDepthPasses = group.passes.filter(
      (pass) => pass.kind === 'helical-contour' && pass.zMm === -2,
    );
    expect(firstDepthPasses.length).toBeGreaterThan(1);
    expect(
      new Set(
        firstDepthPasses.map((pass) =>
          pass.kind === 'helical-contour' ? `${pass.center.x},${pass.center.y}` : '',
        ),
      ).size,
    ).toBeGreaterThan(1);
    for (const pass of firstDepthPasses) {
      if (pass.kind === 'helical-contour') expect(pass.polyline[0]).toEqual(pass.start);
    }
  });

  it('expands depth passes shallow to deep with an exact floor', () => {
    const scene = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'profile-on-path', depthMm: 3, depthPerPassMm: 1.5 })],
      [squareObject('O1', '#ff0000', 20)],
    );
    const group = onlyGroup(scene);
    expect(group.passes.map((pass) => contourPass(pass).zMm)).toEqual([-1.5, -3]);
    expect(group.passes.every((pass) => pass.closed)).toBe(true);
  });

  it('copies the machine coolant mode onto the compiled group; off/absent stays absent', () => {
    const scene = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'profile-on-path', depthMm: 2, depthPerPassMm: 2 })],
      [squareObject('O1', '#ff0000', 20)],
    );
    const flood = {
      ...config,
      params: { ...config.params, coolant: 'flood' as const },
    };
    const floodGroup = compileCncJob(scene, dev, flood).groups[0];
    expect(floodGroup?.kind === 'cnc' ? floodGroup.coolant : null).toBe('flood');
    // The default config's coolant is 'off' → no field on the group (byte- and
    // shape-identical to a pre-coolant job).
    expect(onlyGroup(scene).coolant).toBeUndefined();
  });

  it('closes rings: every closed pass polyline ends at its start', () => {
    const scene = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'profile-outside', depthMm: 2, depthPerPassMm: 2 })],
      [squareObject('O1', '#ff0000', 20)],
    );
    const group = onlyGroup(scene);
    for (const pass of group.passes) {
      const polyline = contourPass(pass).polyline;
      const first = polyline[0];
      const last = polyline[polyline.length - 1];
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
    expect(new Set(tabbed.map((pass) => contourPass(pass).zMm))).toEqual(new Set([-6]));
  });

  it('inserts a full-loop pass at the exact tab top so tabs are the requested height', () => {
    // Single-pass through-cut: without a pass at the tab top, the only pass
    // is tabbed and the "tabs" are full stock thickness (the tab windows are
    // simply never cut). The ladder must gain a full loop at -(depth-tab).
    const scene = sceneWith(
      [
        cncLayer('L1', '#ff0000', {
          cutType: 'profile-outside',
          depthMm: 3,
          depthPerPassMm: 3,
          tabsEnabled: true,
          tabHeightMm: 1,
          tabWidthMm: 6,
          tabsPerShape: 4,
        }),
      ],
      [squareObject('O1', '#ff0000', 40)],
    );
    const group = onlyGroup(scene);
    const fullLoops = group.passes.filter((pass) => pass.closed);
    const tabbed = group.passes.filter((pass) => !pass.closed);
    expect(fullLoops.map((pass) => contourPass(pass).zMm)).toEqual([-2]);
    expect(tabbed).toHaveLength(4);
    expect(new Set(tabbed.map((pass) => contourPass(pass).zMm))).toEqual(new Set([-3]));
  });

  it('compiles v-carve as a clearing group ordered before profiles (H.3)', () => {
    const vbitConfig = { ...config, toolId: 'vb-60' };
    const scene = sceneWith(
      [
        cncLayer('profile', '#ff0000', { cutType: 'profile-outside' }),
        cncLayer('vcarve', '#00ff00', { cutType: 'v-carve', depthMm: 2, vResolutionMm: 0.5 }),
      ],
      [squareObject('O1', '#ff0000', 40), squareObject('O2', '#00ff00', 20)],
    );
    const job = compileCncJob(scene, dev, vbitConfig);
    expect(job.groups).toHaveLength(2);
    const first = job.groups[0];
    const second = job.groups[1];
    if (first?.kind !== 'cnc' || second?.kind !== 'cnc') throw new Error('expected cnc groups');
    expect(first.cutType).toBe('v-carve');
    expect(second.cutType).toBe('profile-outside');
    expect(first.passes.length).toBeGreaterThan(0);
    // Every v-carve depth stays within the configured max.
    for (const pass of first.passes) {
      expect(contourPass(pass).zMm).toBeGreaterThanOrEqual(-2 - 1e-9);
      expect(contourPass(pass).zMm).toBeLessThan(0);
    }
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

  it('is byte-identical with finishAllowanceMm 0 or absent (determinism #5)', () => {
    const base = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'profile-outside', depthMm: 4, depthPerPassMm: 2 })],
      [squareObject('O1', '#ff0000', 40)],
    );
    const zero = sceneWith(
      [
        cncLayer('L1', '#ff0000', {
          cutType: 'profile-outside',
          depthMm: 4,
          depthPerPassMm: 2,
          finishAllowanceMm: 0,
        }),
      ],
      [squareObject('O1', '#ff0000', 40)],
    );
    expect(compileCncJob(zero, dev, config)).toEqual(compileCncJob(base, dev, config));
  });

  it('does not add a finishing pass for out-of-scope cut types (pocket, on-path)', () => {
    for (const cutType of ['pocket', 'profile-on-path'] as const) {
      const withAllowance = sceneWith(
        [
          cncLayer('L1', '#ff0000', {
            cutType,
            depthMm: 4,
            depthPerPassMm: 2,
            finishAllowanceMm: 2,
          }),
        ],
        [squareObject('O1', '#ff0000', 40)],
      );
      const without = sceneWith(
        [cncLayer('L1', '#ff0000', { cutType, depthMm: 4, depthPerPassMm: 2 })],
        [squareObject('O1', '#ff0000', 40)],
      );
      expect(compileCncJob(withAllowance, dev, config)).toEqual(
        compileCncJob(without, dev, config),
      );
    }
  });

  it('leaves stock on roughing and appends one full-depth finishing pass at the true contour', () => {
    const size = 40;
    const layerSettings = (extra: Partial<CncLayerSettings>) => ({
      cutType: 'profile-outside' as const,
      depthMm: 4,
      depthPerPassMm: 2,
      ...extra,
    });
    const noAllowance = onlyGroup(
      sceneWith(
        [cncLayer('L1', '#ff0000', layerSettings({}))],
        [squareObject('O1', '#ff0000', size)],
      ),
    );
    const withAllowance = onlyGroup(
      sceneWith(
        [cncLayer('L1', '#ff0000', layerSettings({ finishAllowanceMm: 2 }))],
        [squareObject('O1', '#ff0000', size)],
      ),
    );
    const spanX = (pass: CncPass) => {
      const xs = contourPass(pass).polyline.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    // Exactly one extra pass: the appended finishing loop.
    expect(withAllowance.passes).toHaveLength(noAllowance.passes.length + 1);
    // Roughing contour sits ~2 mm further out per side (span grows by ~2*allowance).
    const noSpan = Math.max(...noAllowance.passes.map(spanX));
    const roughSpan = Math.max(...withAllowance.passes.map(spanX));
    expect(roughSpan).toBeGreaterThan(noSpan + 3.9);
    // One finishing pass at FULL depth on the TRUE contour (span == no-allowance span).
    const finishing = withAllowance.passes.filter(
      (pass) => Math.abs(contourPass(pass).zMm + 4) < 1e-9 && Math.abs(spanX(pass) - noSpan) < 1e-6,
    );
    expect(finishing).toHaveLength(1);
    expect(finishing[0]?.closed).toBe(true);
  });

  it('keeps holding tabs on the finishing pass so the part is not fully severed', () => {
    const allowanceMm = 2;
    const group = onlyGroup(
      sceneWith(
        [
          cncLayer('L1', '#ff0000', {
            cutType: 'profile-outside',
            depthMm: 6,
            depthPerPassMm: 2,
            finishAllowanceMm: allowanceMm,
            tabsEnabled: true,
            tabHeightMm: 2,
            tabWidthMm: 6,
            tabsPerShape: 4,
          }),
        ],
        [squareObject('O1', '#ff0000', 40)],
      ),
    );
    // Passes are in machine coordinates, so derive the shape center from the
    // overall bounding box (the inflated roughing extent). Every roughing pass
    // reaches that extent; every true-contour finishing pass reaches one
    // allowance short of it — a clean offset/scale-invariant classifier.
    const pts = group.passes.flatMap((pass) => contourPass(pass).polyline);
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
    const reach = (pass: CncPass) =>
      Math.max(
        ...contourPass(pass).polyline.map((p) => Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy))),
      );
    const roughReach = Math.max(...group.passes.map(reach));
    const finishing = group.passes.filter((pass) => reach(pass) <= roughReach - allowanceMm / 2);
    // The true-contour finishing loop is split into multiple OPEN segments —
    // the tab gaps that keep the part attached — all at full depth.
    expect(finishing.length).toBeGreaterThan(1);
    expect(finishing.every((pass) => !pass.closed)).toBe(true);
    expect(finishing.every((pass) => Math.abs(contourPass(pass).zMm + 6) < 1e-9)).toBe(true);
  });

  it('drops engrave polylines with non-finite points instead of compiling NaN passes', () => {
    // Engrave is the one cut type that takes source polylines verbatim, so it
    // must apply the same hasFinitePoints guard as profile/pocket/v-carve/drill
    // — a NaN here would otherwise emit as a literal "G1 XNaN" (invisible to
    // parseGcodeWord-based preflight scanners).
    const clean = squareObject('O1', '#ff0000', 20);
    const corrupt: ImportedSvg = {
      ...clean,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            ...clean.paths[0]!.polylines,
            {
              closed: false,
              points: [
                { x: NaN, y: 10 },
                { x: 30, y: 10 },
              ],
            },
          ],
        },
      ],
    };
    const scene = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'engrave', depthMm: 1 })],
      [corrupt],
    );
    const group = onlyGroup(scene);
    expect(group.passes.length).toBeGreaterThan(0);
    for (const pass of group.passes) {
      for (const point of contourPass(pass).polyline) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }
  });
});
