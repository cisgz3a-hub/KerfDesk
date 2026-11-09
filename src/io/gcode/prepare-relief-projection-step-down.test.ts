// Rolling audit v11 W6-P2-1 (refuter P1): a relief projection cut its whole
// Vertical depth in one pass and ignored the layer's Depth per pass and Tabs,
// so a closed square projected through the stock came free while Job Review
// listed tabs and "N passes" from the ignored Cut depth. These run the
// refuter's repro (zz-w6r/p3.mts, p1.mts) through the real pipeline.
import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { passRisesIntoTab } from '../../core/cnc/compiled-tab-rises';
import type { CncGroup, CncPass } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import { detectMachineJobWarnings } from '../../ui/laser/machine-job-warnings';
import { buildEffectiveOperationReview } from '../../ui/laser/job-review/job-review-effective-operations';
import { cncOperationDetail } from '../../ui/laser/job-review/job-review-detail-facts';
import { prepareOutput } from './prepare-output';

const PX = 0.5;
const WMM = 40;
const W = WMM / PX;

// A 40 x 40 mm plaque with a 30 x 30 mm floor 5 mm deep and a flat rim on top.
function plaque(): ReliefObject {
  const samples = Array.from({ length: W * W }, (_, i) => {
    const x = ((i % W) + 0.5) * PX;
    const y = (Math.floor(i / W) + 0.5) * PX;
    return x > 5 && x < 35 && y > 5 && y < 35 ? 0 : 0xffff;
  });
  return {
    kind: 'relief',
    id: 'relief',
    source: 'dish.png',
    color: '#a0522d',
    reliefSource: testReliefHeightfield({
      width: W,
      height: W,
      physicalWidthMm: WMM,
      physicalHeightMm: WMM,
      maxDepthMm: 5,
      samplesU16: samples,
    }),
    targetWidthMm: WMM,
    reliefDepthMm: 5,
    bounds: { minX: 20, minY: 20, maxX: 60, maxY: 60 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    operationIds: ['target'],
  } as ReliefObject;
}

function vector(closed: boolean): SceneObject {
  const points = closed
    ? [
        { x: 32, y: 32 },
        { x: 48, y: 32 },
        { x: 48, y: 48 },
        { x: 32, y: 48 },
      ]
    : [
        { x: 30, y: 40 },
        { x: 50, y: 40 },
      ];
  return {
    kind: 'imported-svg',
    id: 'sq',
    source: 'sq.svg',
    operationIds: ['proj'],
    bounds: { minX: 30, minY: 32, maxX: 50, maxY: 48 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed, points }] }],
  } as SceneObject;
}

function project(options: {
  readonly verticalDepthMm: number;
  readonly stockMm: number;
  readonly cnc?: Partial<CncLayerSettings>;
  readonly closed?: boolean;
}): Project {
  const base = createProject();
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: options.stockMm },
    },
    scene: {
      ...base.scene,
      objects: [plaque(), vector(options.closed ?? true)],
      artworkOrder: ['relief', 'sq'],
      layers: [
        {
          ...createLayer({ id: 'target', color: '#a0522d', name: 'Relief' }),
          output: true,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthPerPassMm: 1.5 },
        },
        {
          ...createLayer({ id: 'proj', color: '#000000', name: 'Projected' }),
          output: true,
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'profile-on-path',
            depthMm: 1,
            depthPerPassMm: 1,
            tabsEnabled: true,
            ...options.cnc,
            reliefProjection: {
              reliefObjectId: 'relief',
              depthMm: options.verticalDepthMm,
              depthConvention: 'vertical',
              sampleSpacingMm: 0.2,
            },
          },
        },
      ],
    },
  } as Project;
}

function prepared(p: Project) {
  const result = prepareOutput(p);
  if (!result.ok) throw new Error(JSON.stringify(result.preflight));
  const passes = result.job.groups
    .filter((group): group is CncGroup => group.kind === 'cnc' && group.layerId === 'proj')
    .flatMap((group) => group.passes);
  const effective = buildEffectiveOperationReview(result.job, p.scene).find(
    (entry) => entry.layerId === 'proj',
  );
  const settings = p.scene.layers[1]?.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const stockMm = p.machine?.kind === 'cnc' ? p.machine.stock.thicknessMm : 0;
  const detail = cncOperationDetail(
    settings,
    stockMm,
    effective?.plungingReliefStages,
    effective?.relief,
    effective?.unrampedShapes,
    effective === undefined ? undefined : effective.tabbedShapes === true,
    effective?.strategyFallback,
    effective?.projection,
  );
  const warnings = detectMachineJobWarnings(p, null, null, result);
  return { result, passes, detail, warnings };
}

function zs(pass: CncPass | undefined): ReadonlyArray<number> {
  return pass?.kind === 'path3d' ? pass.points.map((point) => point.z) : [];
}

describe('relief projection honours Depth per pass and Tabs (W6-P2-1)', () => {
  it('steps a 2 mm projection down in two 1 mm levels and tabs the closed square', () => {
    const { passes, detail, warnings } = prepared(project({ verticalDepthMm: 2, stockMm: 6 }));
    expect(passes).toHaveLength(2);
    // Both levels follow the 5 mm floor: 1 mm, then 2 mm under it.
    expect(Math.min(...zs(passes[0]))).toBeCloseTo(-6, 3);
    expect(Math.min(...zs(passes[1]))).toBeCloseTo(-7, 3);
    // Set 6 mm stock: each tab stands 2 mm above the stock bottom, at Z-4,
    // so every level rises into it; the square no longer comes free.
    expect(passes.every(passRisesIntoTab)).toBe(true);
    expect(Math.max(...zs(passes[1]))).toBeCloseTo(-4, 3);
    expect(detail).toContain('projected 2 mm under the relief surface in 2 passes of up to 1 mm');
    expect(detail).toContain('deepest 7 mm');
    expect(detail).toContain(
      'tabs 4 per shape (6 × 2 mm above the stock bottom) on 1 of 1 closed shape',
    );
    expect(detail).not.toContain('floor holds');
    // Not freed, but still past the 6 mm stock bottom between the tabs.
    expect(warnings.join('\n')).toContain('reaches 7 mm into 6 mm stock — 1.00 mm past the bottom');
  });

  it('warns that a closed square cut through with Tabs off comes free', () => {
    const { passes, detail, warnings } = prepared(
      project({ verticalDepthMm: 2, stockMm: 6, cnc: { tabsEnabled: false } }),
    );
    expect(passes.some(passRisesIntoTab)).toBe(false);
    expect(detail).toContain('no holding tab on 1 closed shape cut free');
    expect(warnings).toContainEqual(
      expect.stringContaining(
        'cuts 1 closed shape through the stock all the way round with no holding tab — the parts come free',
      ),
    );
  });

  it('keeps the tab from the cut floor on the shipped stock thickness, as 2D profiles do', () => {
    const stockMm = DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm;
    const { passes, detail } = prepared(project({ verticalDepthMm: 2, stockMm }));
    // Deepest tip Z-7, tab 2 mm: the windows stand at Z-5, the plaque floor.
    expect(passes.every(passRisesIntoTab)).toBe(true);
    expect(Math.max(...zs(passes[1]))).toBeCloseTo(-5, 3);
    expect(detail).toContain('6 × 2 mm above the cut floor');
  });

  it('says the floor holds the part when a set stock leaves one under the deepest cut', () => {
    const { passes, detail, warnings } = prepared(project({ verticalDepthMm: 1, stockMm: 12 }));
    expect(passes).toHaveLength(1);
    expect(passes.some(passRisesIntoTab)).toBe(false);
    expect(detail).toContain(
      'tabs skipped: the 6 mm floor under the deepest projected cut holds the part',
    );
    expect(warnings).toContainEqual(expect.stringContaining('Projected skips its holding tabs'));
  });

  it('cuts in one pass when Depth per pass covers the vertical depth (unchanged output)', () => {
    const { passes, detail } = prepared(
      project({ verticalDepthMm: 1.5, stockMm: 12, cnc: { depthPerPassMm: 1.5, depthMm: 8 } }),
    );
    expect(passes).toHaveLength(1);
    expect(Math.min(...zs(passes[0]))).toBeCloseTo(-6.5, 3);
    expect(detail).toContain('in 1 pass, deepest 6.5 mm');
    expect(detail).not.toMatch(/\b\d+ passes\b/);
  });

  it('judges the spoilboard on the compiled depth, not the ignored Cut depth', () => {
    // An open line 3 mm under the floor: Z-8 past 6.35 mm stock, three levels.
    const deep = prepared(
      project({ verticalDepthMm: 3, stockMm: 6.35, closed: false, cnc: { depthMm: 1 } }),
    );
    expect(deep.passes).toHaveLength(3);
    expect(deep.warnings).toContainEqual(
      expect.stringContaining('reaches 8 mm into 6.35 mm stock — 1.65 mm past the bottom'),
    );
    // A stale Cut depth of 8 mm no longer reports a spoilboard cut that stays in the stock.
    const shallow = prepared(
      project({ verticalDepthMm: 0.5, stockMm: 7, closed: false, cnc: { depthMm: 8 } }),
    );
    expect(shallow.warnings.join('\n')).not.toContain('spoilboard');
    expect(shallow.warnings.join('\n')).not.toContain('cuts 8 mm');
  });
});
