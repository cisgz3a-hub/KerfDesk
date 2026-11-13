// CNC audit v3 N6-P2-1 and N6r-P2-1 (ADR-233 Amendment 1). Every case reads
// the emitted program: its S word, its cutting and plunge F words, and the chip
// load they give (F / (S × flutes)).
import { describe, expect, it } from 'vitest';
import { mcpCncPatchSchema } from '../../../electron/mcp/design-schemas';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { partitionSavePreflight } from '../../ui/app/save-preflight-policy';
import { buildEffectiveOperationReview } from '../../ui/laser/job-review/job-review-effective-operations';
import { partitionEmitPreflight } from '../../ui/laser/start-job-readiness-policy';
import { operationPatchSchema } from '../../ui/remote-control/design-validation';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TOOLS,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../scene';
import { cncCuttingRates } from './cnc-cutting-rates';

const SIXTEENTH = 'em-1588';
const FLUTES = 2;

function square(id: string, color: string, at: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: at, minY: at, maxX: at + 40, maxY: at + 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: at },
              { x: at + 40, y: at },
              { x: at + 40, y: at + 40 },
              { x: at, y: at + 40 },
            ],
          },
        ],
      },
    ],
  };
}

function layer(id: string, color: string, cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id, color, name: `Op ${id}` }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside',
      toolId: SIXTEENTH,
      depthMm: 1,
      depthPerPassMm: 0.5,
      ...cnc,
    },
  };
}

/** A Genmitsu 4040-PRO-like ceiling: Spindle maximum 9,000 RPM. */
function project(layers: ReadonlyArray<Layer>, objects = [square('part', '#ff0000', 50)]): Project {
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleMaxRpm: 9000 },
    },
    scene: { objects, layers: [...layers] },
  };
}

type ProgramRates = {
  readonly spindle: ReadonlyArray<number>;
  readonly cutFeeds: ReadonlyArray<number>;
  readonly plungeFeeds: ReadonlyArray<number>;
};

// S from every spindle start; F from XY cutting moves and Z-only plunges.
function programRates(gcode: string): ProgramRates {
  const spindle: number[] = [];
  const cutFeeds: number[] = [];
  const plungeFeeds: number[] = [];
  for (const line of gcode.split('\n')) {
    if (line.startsWith(';')) continue;
    const s = /\bM3\b.*\bS(\d+(?:\.\d+)?)/.exec(line);
    if (s !== null) spindle.push(Number(s[1]));
    const f = /^G1\b.*\bF(\d+(?:\.\d+)?)/.exec(line);
    if (f === null) continue;
    if (/\b[XY]-?\d/.test(line)) cutFeeds.push(Number(f[1]));
    else if (/\bZ-?\d/.test(line)) plungeFeeds.push(Number(f[1]));
  }
  return { spindle, cutFeeds, plungeFeeds };
}

function single(values: ReadonlyArray<number>): number {
  const unique = [...new Set(values)];
  expect(unique).toHaveLength(1);
  return unique[0]!;
}

function chipLoad(feed: number, rpm: number): number {
  return feed / (rpm * FLUTES);
}

describe('a capped spindle scales the feeds (N6-P2-1, ADR-233 Amd 1)', () => {
  it('sends S9000 F540 for a 1/16" layer planned at 24,000 RPM and F1440, holding 0.030 mm/tooth', () => {
    const result = emitGcode(
      project([
        layer('a', '#ff0000', { spindleRpm: 24000, feedMmPerMin: 1440, plungeMmPerMin: 300 }),
      ]),
    );
    const rates = programRates(result.gcode);

    const s = single(rates.spindle);
    const f = single(rates.cutFeeds);
    expect(s).toBe(9000);
    expect(f).toBe(540);
    expect(single(rates.plungeFeeds)).toBe(112); // 300 × 0.375 = 112.5, floored
    // Main sent F1440 S9000: 0.080 mm/tooth, 2.67× the planned 0.030.
    expect(chipLoad(f, s)).toBeCloseTo(chipLoad(1440, 24000), 6);
    expect(result.gcode).toContain(
      '; cnc spindle-capped: requested-rpm: 24000; requested-feed-mm-min: 1440; requested-plunge-mm-min: 300',
    );
  });

  it('leaves a layer at or under the ceiling byte-for-byte as asked', () => {
    const result = emitGcode(
      project([layer('a', '#ff0000', { spindleRpm: 9000, feedMmPerMin: 1440 })]),
    );
    const rates = programRates(result.gcode);

    expect(single(rates.spindle)).toBe(9000);
    expect(single(rates.cutFeeds)).toBe(1440);
    expect(result.gcode).not.toContain('spindle-capped');
  });

  it('scales a stage recipe that asks for more RPM than the machine has', () => {
    const result = emitGcode(
      project([
        layer('a', '#ff0000', {
          spindleRpm: 9000,
          feedMmPerMin: 600,
          finishAllowanceMm: 0.3,
          stageRecipes: {
            'profile-finish': {
              toolId: SIXTEENTH,
              depthPerPassMm: 1,
              feedMmPerMin: 2880,
              plungeMmPerMin: 400,
              spindleRpm: 24000,
            },
          },
        }),
      ]),
    );
    const rates = programRates(result.gcode);

    expect(new Set(rates.spindle)).toEqual(new Set([9000]));
    // Roughing keeps its own F600 at 9000; the recipe's F2880 at 24,000 becomes F1080.
    expect(new Set(rates.cutFeeds)).toEqual(new Set([600, 1080]));
    expect(chipLoad(1080, 9000)).toBeCloseTo(chipLoad(2880, 24000), 6);
  });

  it('Job Review states the capped RPM, the lowered feed and the chip load that results', () => {
    const prepared = prepareOutput(
      project([
        layer('a', '#ff0000', { spindleRpm: 24000, feedMmPerMin: 1440, plungeMmPerMin: 300 }),
      ]),
    );
    if (!prepared.ok) throw new Error('expected the job to prepare');
    const summary = buildEffectiveOperationReview(prepared.job)[0]?.summaries[0];

    expect(summary).toContain('540 mm/min feed');
    expect(summary).toContain(
      '9,000 RPM (capped from 24,000 RPM requested; feed lowered from 1,440 and plunge from 300 mm/min by the same ratio to hold the chip load)',
    );
    // The starter bit now carries its flute count, so the chip load is shown.
    expect(summary).toContain('0.0300 mm/tooth programmed nominal chipload');
  });

  it('caps S, scales F and plunge by the same ratio, then caps them to Max feed', () => {
    expect(
      cncCuttingRates({ feedMmPerMin: 1440, plungeMmPerMin: 300, spindleRpm: 24000 }, 6000, 9000),
    ).toEqual({
      feedMmPerMin: 540,
      plungeMmPerMin: 112.5,
      spindleRpm: 9000,
      spindleCap: {
        requestedRpm: 24000,
        requestedFeedMmPerMin: 1440,
        requestedPlungeMmPerMin: 300,
      },
    });
    // Max feed applies after the scale: 16000 × 0.5 = 8000, then 6000.
    expect(
      cncCuttingRates({ feedMmPerMin: 16000, plungeMmPerMin: 300, spindleRpm: 18000 }, 6000, 9000)
        .feedMmPerMin,
    ).toBe(6000);
    // Nothing to scale at or under the ceiling, or for a non-positive RPM.
    expect(
      cncCuttingRates({ feedMmPerMin: 1000, plungeMmPerMin: 300, spindleRpm: 9000 }, 6000, 9000),
    ).toEqual({
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 9000,
    });
    expect(
      cncCuttingRates({ feedMmPerMin: 1000, plungeMmPerMin: 300, spindleRpm: 0 }, 6000, 9000),
    ).toEqual({
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 0,
    });
  });

  it('gives every starter end mill and ball nose a flute count, and no V-bit one', () => {
    for (const tool of DEFAULT_CNC_TOOLS) {
      expect(tool.fluteCount, tool.id).toBe(tool.kind === 'v-bit' ? undefined : 2);
    }
  });
});

describe('a spindle at 0 RPM refuses Save and Start (N6r-P2-1)', () => {
  // Main: the program held `M3 S0` then `G1 Z-0.500 F300`, and Save and Start
  // only listed "spindle RPM must be greater than 0" as a warning.
  it('the program that would cut at M3 S0 refuses Save and Start', () => {
    const result = emitGcode(project([layer('a', '#ff0000', { spindleRpm: 0 })]));
    expect(result.gcode).toMatch(/M3 S0\b/);

    const save = partitionSavePreflight(result.preflight.issues);
    const start = partitionEmitPreflight(result.preflight);
    expect(save.blocking.map((issue) => issue.code)).toEqual(['cnc-spindle-off']);
    expect(save.blocking[0]?.message).toContain('Layer "Op a" has a spindle speed of 0 RPM');
    expect(start.blocking).toHaveLength(1);
    expect(start.blocking[0]).toContain('cut with the bit standing still');
  });

  it('does not refuse for an output layer at 0 RPM that has no artwork, since it sends nothing', () => {
    const result = emitGcode(
      project([
        layer('a', '#ff0000', { spindleRpm: 12000 }),
        layer('b', '#00ff00', { spindleRpm: 0 }),
      ]),
    );

    expect(result.gcode).not.toMatch(/M3 S0\b/);
    expect(partitionSavePreflight(result.preflight.issues).blocking).toEqual([]);
  });

  it('the remote and MCP operation schemas refuse a spindle below the layer card floor', () => {
    expect(mcpCncPatchSchema.safeParse({ spindleRpm: 0 }).success).toBe(false);
    expect(mcpCncPatchSchema.safeParse({ spindleRpm: 999 }).success).toBe(false);
    expect(mcpCncPatchSchema.safeParse({ spindleRpm: 1000 }).success).toBe(true);
    expect(operationPatchSchema.safeParse({ cnc: { spindleRpm: 0 } }).success).toBe(false);
    expect(operationPatchSchema.safeParse({ cnc: { spindleRpm: 1000 } }).success).toBe(true);
  });
});
