import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import type { Job } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncLayerSettings,
  type CncStock,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../../core/scene';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { detectCncMachineLimitWarnings } from './cnc-machine-limit-warnings';

function square(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'part',
    source: 'part.svg',
    bounds: { minX: 50, minY: 50, maxX: 90, maxY: 90 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 90, y: 50 },
              { x: 90, y: 90 },
              { x: 50, y: 90 },
            ],
          },
        ],
      },
    ],
  };
}

// Default CNC stock is 400 × 400 mm; the default layer feed is 1000 mm/min,
// plunge 300 mm/min, spindle 12000 RPM.
function cncProject(args: {
  readonly stock?: Partial<CncStock>;
  readonly feedMmPerMin?: number;
  readonly plungeMmPerMin?: number;
  readonly spindleRpm?: number;
  readonly output?: boolean;
}): Project {
  const layer: Layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    ...(args.output === undefined ? {} : { output: args.output }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      ...(args.feedMmPerMin === undefined ? {} : { feedMmPerMin: args.feedMmPerMin }),
      ...(args.plungeMmPerMin === undefined ? {} : { plungeMmPerMin: args.plungeMmPerMin }),
      ...(args.spindleRpm === undefined ? {} : { spindleRpm: args.spindleRpm }),
    },
  };
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, ...args.stock },
    },
    scene: { objects: [], layers: [layer] },
  };
}

describe('detectCncMachineLimitWarnings (ADR-111)', () => {
  it('is silent when no controller is connected (limits null)', () => {
    expect(detectCncMachineLimitWarnings(cncProject({ stock: { widthMm: 900 } }), null)).toEqual(
      [],
    );
  });

  it('is silent for a laser project even with limits present', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 100, bedHeight: 100, maxFeed: 1 };
    expect(detectCncMachineLimitWarnings(createProject(), limits)).toEqual([]);
  });

  it('is silent when the job sits inside the reported limits', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400, maxFeed: 1500 };
    expect(detectCncMachineLimitWarnings(cncProject({}), limits)).toEqual([]);
  });

  it('warns when stock is wider than the reported travel', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400 };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ stock: { widthMm: 500 } }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('X reaches 500 mm > 400 mm');
    expect(warning).toContain('reported travel');
  });

  // Audit 1.18: the check compared raw stock size, so stock pushed out along an
  // axis by originOffset overhung travel with no warning at all.
  // Audit 4.4: preflight no longer refuses a layer above the configured
  // ceiling, so the operator has to learn it here instead — the job still runs,
  // just clamped, with feeds that assume the higher RPM. Default ceiling is
  // 12000 RPM.
  it('warns when a layer requests more spindle than the configured ceiling', () => {
    const [warning, ...rest] = detectCncMachineLimitWarnings(cncProject({ spindleRpm: 24000 }), {});
    expect(rest).toEqual([]);
    expect(warning).toContain('24000');
    expect(warning).toContain('12000');
    expect(warning).toContain('compiled spindle setting is limited to 12000 RPM');
  });

  it('stays silent when the layer sits on the configured ceiling', () => {
    expect(detectCncMachineLimitWarnings(cncProject({ spindleRpm: 12000 }), {})).toEqual([]);
  });

  it('counts the origin offset toward the overhang', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400 };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ stock: { widthMm: 300, heightMm: 300, originOffset: { x: 150, y: 150 } } }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('X reaches 450 mm > 400 mm');
    expect(warning).toContain('Y reaches 450 mm > 400 mm');
  });

  it('stays silent when the offset still leaves the stock inside travel', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400 };
    expect(
      detectCncMachineLimitWarnings(
        cncProject({ stock: { widthMm: 300, heightMm: 300, originOffset: { x: 50, y: 50 } } }),
        limits,
      ),
    ).toEqual([]);
  });

  it('names only the axis that overhangs (height)', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400 };
    const [warning] = detectCncMachineLimitWarnings(
      cncProject({ stock: { heightMm: 450 } }),
      limits,
    );
    expect(warning).toContain('Y reaches 450 mm > 400 mm');
    expect(warning).not.toContain('X reaches');
  });

  it('warns when a layer feed exceeds the reported max rate', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 800 };
    const [warning] = detectCncMachineLimitWarnings(cncProject({ feedMmPerMin: 1200 }), limits);
    expect(warning).toContain('1200 mm/min');
    expect(warning).toContain('800 mm/min');
  });

  it('ignores feed on layers that do not output', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 800 };
    const project = cncProject({ feedMmPerMin: 5000, output: false });
    expect(detectCncMachineLimitWarnings(project, limits)).toEqual([]);
  });

  it('cannot warn about feed when the snapshot has no max rate', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400 };
    expect(detectCncMachineLimitWarnings(cncProject({ feedMmPerMin: 9000 }), limits)).toEqual([]);
  });

  it('warns against the SLOWER reported axis rate on an asymmetric machine', () => {
    const limits: ControllerSettingsSnapshot = {
      maxFeed: 10000,
      maxFeedX: 10000,
      maxFeedY: 6000,
    };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ feedMmPerMin: 8000 }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('8000 mm/min');
    expect(warning).toContain('6000 mm/min');
  });

  it('is silent when the feed fits under the slower reported axis rate', () => {
    const limits: ControllerSettingsSnapshot = {
      maxFeed: 10000,
      maxFeedX: 10000,
      maxFeedY: 6000,
    };
    expect(detectCncMachineLimitWarnings(cncProject({ feedMmPerMin: 6000 }), limits)).toEqual([]);
  });

  it('warns when a layer plunge exceeds the reported Z max rate ($112)', () => {
    const limits: ControllerSettingsSnapshot = { zMaxFeed: 200 };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ plungeMmPerMin: 300 }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('plunge 300 mm/min');
    expect(warning).toContain('200 mm/min');
  });

  it('is silent about plunge when the snapshot has no Z max rate', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 5000 };
    expect(detectCncMachineLimitWarnings(cncProject({ plungeMmPerMin: 9000 }), limits)).toEqual([]);
  });

  it('warns when a layer spindle RPM exceeds the reported $30 max', () => {
    const limits: ControllerSettingsSnapshot = { maxPowerS: 10000 };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ spindleRpm: 12000 }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('12000 RPM');
    expect(warning).toContain('10000 RPM');
  });

  it('is silent when the spindle RPM equals the reported $30 max', () => {
    const limits: ControllerSettingsSnapshot = { maxPowerS: 12000 };
    expect(detectCncMachineLimitWarnings(cncProject({ spindleRpm: 12000 }), limits)).toEqual([]);
  });

  it('ignores plunge and spindle on layers that do not output', () => {
    const limits: ControllerSettingsSnapshot = { zMaxFeed: 100, maxPowerS: 5000 };
    const project = cncProject({ plungeMmPerMin: 900, spindleRpm: 24000, output: false });
    expect(detectCncMachineLimitWarnings(project, limits)).toEqual([]);
  });

  it('emits both a stock and a feed advisory together', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 300, bedHeight: 300, maxFeed: 500 };
    const warnings = detectCncMachineLimitWarnings(
      cncProject({ stock: { widthMm: 600, heightMm: 600 }, feedMmPerMin: 1000 }),
      limits,
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('exceeds the machine');
    expect(warnings[1]).toContain('above the machine');
  });
});

// ADR-457 Amd 1: stage recipes emit their own feed, plunge and RPM, so they
// reach the same advisories. Advisories only; nothing here refuses a job.
describe('detectCncMachineLimitWarnings with stage recipes', () => {
  function withWallRecipe(
    toolId: string,
    values: { feedMmPerMin: number; plungeMmPerMin: number; spindleRpm: number },
  ): Project {
    const project = cncProject({});
    const layer = project.scene.layers[0]!;
    return {
      ...project,
      scene: {
        ...project.scene,
        layers: [
          {
            ...layer,
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              stageRecipes: { 'profile-finish': { toolId, depthPerPassMm: 1, ...values } },
            },
          },
        ],
      },
    };
  }
  const libraryToolId = DEFAULT_CNC_MACHINE_CONFIG.tools[0]!.id;
  const hot = { feedMmPerMin: 4000, plungeMmPerMin: 1500, spindleRpm: 30_000 };
  const WALL_RECIPE = 'The Wall finishing recipe on layer "Operation"';

  it('names a recipe whose feed, plunge or RPM exceeds $110/$112/$30', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 2000, zMaxFeed: 500, maxPowerS: 24_000 };
    const warnings = detectCncMachineLimitWarnings(withWallRecipe(libraryToolId, hot), limits);
    expect(warnings.some((w) => w.includes(`${WALL_RECIPE} requests feed 4000`))).toBe(true);
    expect(warnings.some((w) => w.includes(`${WALL_RECIPE} requests plunge 1500`))).toBe(true);
    expect(warnings.some((w) => w.includes(`${WALL_RECIPE} requests spindle 30000`))).toBe(true);
  });

  it('compares recipe RPM with the configured spindle ceiling offline', () => {
    const warnings = detectCncMachineLimitWarnings(withWallRecipe(libraryToolId, hot), null);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`${WALL_RECIPE} requests spindle 30000`);
  });

  it('ignores a recipe bound to a cutter that is not in the tool library', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 2000, zMaxFeed: 500, maxPowerS: 24_000 };
    expect(detectCncMachineLimitWarnings(withWallRecipe('no-such-cutter', hot), limits)).toEqual(
      [],
    );
  });
});

// P2-review-4: a layer keeps a recipe its cut type no longer uses (ADR-481).
// With the compiled job only the stages the job ran count, and every advisory
// names its layer (ADR-457 Amd 2).
describe('detectCncMachineLimitWarnings with a compiled job', () => {
  const libraryToolId = DEFAULT_CNC_MACHINE_CONFIG.tools[0]!.id;
  const hot = { toolId: libraryToolId, depthPerPassMm: 1, feedMmPerMin: 5000 };
  const limits: ControllerSettingsSnapshot = { maxFeed: 3000, zMaxFeed: 600, maxPowerS: 12_000 };

  function profileProject(cnc: Partial<CncLayerSettings>): Project {
    const layer: Layer = {
      ...createLayer({ id: 'L1', color: '#ff0000', name: 'Outline' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-outside',
        depthMm: 3,
        depthPerPassMm: 1.5,
        ...cnc,
      },
    };
    return {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { objects: [square()], layers: [layer] },
    };
  }

  function compiled(project: Project): Job {
    if (project.machine?.kind !== 'cnc') throw new Error('expected a CNC project');
    return compileCncJob(project.scene, project.device, project.machine);
  }

  it('ignores a V-carve clearing recipe left on a profile layer', () => {
    const project = profileProject({
      stageRecipes: { 'v-clear': { ...hot, plungeMmPerMin: 1500, spindleRpm: 18_000 } },
    });

    expect(detectCncMachineLimitWarnings(project, limits, compiled(project))).toEqual([]);
    // Without the compiled job the recipe still counts, as before.
    expect(detectCncMachineLimitWarnings(project, limits)).toHaveLength(4);
  });

  it('compares a Wall finishing recipe the job ran and names its layer', () => {
    const project = profileProject({
      finishAllowanceMm: 0.5,
      stageRecipes: { 'profile-finish': { ...hot, plungeMmPerMin: 300, spindleRpm: 12_000 } },
    });

    expect(detectCncMachineLimitWarnings(project, limits, compiled(project))).toEqual([
      'The Wall finishing recipe on layer "Outline" requests feed 5000 mm/min, above the ' +
        "machine's reported max rate 3000 mm/min — the controller clamps to its limit, so the " +
        'cut runs slower than planned.',
    ]);
  });

  it('names the layer whose own feed is above the limit', () => {
    const project = profileProject({ feedMmPerMin: 4000 });

    const [warning] = detectCncMachineLimitWarnings(project, limits, compiled(project));
    expect(warning).toContain('Layer "Outline" requests feed 4000 mm/min');
  });
});
