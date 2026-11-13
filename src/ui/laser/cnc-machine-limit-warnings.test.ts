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
    scene: { objects: [square()], layers: [layer] },
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
  // ADR-233 Amd 1: the compiler now scales the feeds with the capped S, so
  // the warning says the chip load holds and the cut runs slower (N6-P2-1).
  it('warns when a layer requests more spindle than the configured ceiling', () => {
    const [warning, ...rest] = detectCncMachineLimitWarnings(cncProject({ spindleRpm: 24000 }), {});
    expect(rest).toEqual([]);
    expect(warning).toBe(
      'Layer "Operation" requests spindle 24000 RPM but the machine\'s Spindle maximum is ' +
        '12000 RPM — the program sends S12000 and lowers its feed from 1000 to 500 mm/min and ' +
        'plunge from 300 to 150 mm/min by the same ratio, so each tooth keeps the chip load ' +
        'planned at 24000 RPM and the cut runs slower. To plan at the speed the machine runs, ' +
        'set the spindle to 12000 RPM or reapply the material.',
    );
    expect(warning).not.toContain('Verify the controller-to-spindle scale');
  });

  // CNC audit v3 N6-P3-2: a layer with no artwork sends nothing.
  it('ignores a layer with no artwork', () => {
    const project = cncProject({ spindleRpm: 30000, feedMmPerMin: 5900 });
    const empty = { ...project, scene: { ...project.scene, objects: [] } };
    expect(detectCncMachineLimitWarnings(empty, { maxFeed: 3000 })).toEqual([]);
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
      maxFeedY: 5000,
    };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ feedMmPerMin: 5500 }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('5500 mm/min');
    expect(warning).toContain('5000 mm/min');
  });

  // The program never sends more than CNC Max feed (6000 here); the layer's
  // own 8000 gets the preflight advisory instead.
  it('compares the feed the program sends, capped at CNC Max feed', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 10000, maxFeedY: 6000 };
    expect(detectCncMachineLimitWarnings(cncProject({ feedMmPerMin: 8000 }), limits)).toEqual([]);
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
    // N6-P2-1's live sibling: name the chip-load rise and the remedy that fixes it.
    expect(warning).toContain('each tooth takes 1.2× the planned chip load');
    expect(warning).toContain('set Spindle maximum to 10000 RPM in Machine Setup');
    expect(warning).not.toContain('Verify the controller-to-spindle scale');
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
    // At the 12,000 RPM ceiling, so nothing is scaled and the program sends these.
    const atCeiling = { ...hot, spindleRpm: 12_000 };
    const limits: ControllerSettingsSnapshot = { maxFeed: 2000, zMaxFeed: 500, maxPowerS: 10_000 };
    const warnings = detectCncMachineLimitWarnings(withWallRecipe(libraryToolId, atCeiling), limits);
    expect(warnings.some((w) => w.includes(`${WALL_RECIPE} requests feed 4000`))).toBe(true);
    expect(warnings.some((w) => w.includes(`${WALL_RECIPE} requests plunge 1500`))).toBe(true);
    expect(warnings.some((w) => w.includes(`${WALL_RECIPE} requests spindle 12000`))).toBe(true);
  });

  // ADR-233 Amd 1: above the ceiling the program sends S12000 and scales F4000
  // to 1600 and plunge 1500 to 600, so only the plunge is over $112 and the
  // ceiling line names the recipe.
  it('compares the scaled recipe values when its RPM is above the ceiling', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 2000, zMaxFeed: 500, maxPowerS: 24_000 };
    const warnings = detectCncMachineLimitWarnings(withWallRecipe(libraryToolId, hot), limits);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(`${WALL_RECIPE} requests plunge 600 mm/min`);
    expect(warnings[1]).toContain(`${WALL_RECIPE} requests spindle 30000 RPM`);
    expect(warnings[1]).toContain('feed from 4000 to 1600 mm/min and plunge from 1500 to 600');
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
    // Without the compiled job the recipe still counts. Its 18000 RPM is
    // capped to 12000, which $30 accepts, so three lines: feed, plunge, ceiling.
    expect(detectCncMachineLimitWarnings(project, limits)).toHaveLength(3);
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

  // CNC audit v3 N6-P3-2: a drill cycle sends no XY cutting feed.
  it('ignores the feed of a drill layer, which the program never sends', () => {
    const project = profileProject({ cutType: 'drill', feedMmPerMin: 4500, plungeMmPerMin: 300 });

    expect(detectCncMachineLimitWarnings(project, limits, compiled(project))).toEqual([]);
    expect(detectCncMachineLimitWarnings(project, limits)).toEqual([]);
  });

  it('names the layer whose own feed is above the limit', () => {
    const project = profileProject({ feedMmPerMin: 4000 });

    const [warning] = detectCncMachineLimitWarnings(project, limits, compiled(project));
    expect(warning).toContain('Layer "Outline" requests feed 4000 mm/min');
  });
});
