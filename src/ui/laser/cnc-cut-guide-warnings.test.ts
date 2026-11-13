// CNC audit FS-5, JR-5 and the FS-2 warning (ADR-233 Amendment 2). Each case
// reads the emitted program, then the Job Review warnings for the same job.
import { describe, expect, it } from 'vitest';
import { resolveCncMaterialFeedPatch } from '../../core/cnc/machine-starters/resolve-cnc-auto-settings';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncTool,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { detectMachineJobWarnings } from './machine-job-warnings';

const PART: ImportedSvg = {
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

function project(
  cnc: Partial<CncLayerSettings>,
  tools: ReadonlyArray<CncTool> = DEFAULT_CNC_MACHINE_CONFIG.tools,
): Project {
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 25 },
    },
    scene: {
      objects: [PART],
      layers: [
        {
          ...createLayer({ id: 'L', color: '#ff0000', name: 'Part' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside', ...cnc },
        },
      ],
    },
  };
}

function reviewWarnings(subject: Project): ReadonlyArray<string> {
  const prepared = prepareOutput(subject);
  if (!prepared.ok) throw new Error('expected the job to prepare');
  return detectMachineJobWarnings(subject, null, null, prepared);
}

function cutFeeds(gcode: string): number[] {
  return gcode
    .split('\n')
    .filter((line) => /^G1\b/.test(line) && /\b[XY]-?\d/.test(line))
    .flatMap((line) => {
      const f = /\bF(\d+(?:\.\d+)?)/.exec(line);
      return f === null ? [] : [Number(f[1])];
    });
}

function cutDepths(gcode: string): number[] {
  return gcode.split('\n').flatMap((line) => {
    const z = /^G1\b.*\bZ(-\d+(?:\.\d+)?)/.exec(line);
    return z === null ? [] : [Number(z[1])];
  });
}

describe('material chip load is continuous in bit diameter (FS-5)', () => {
  // Main took the 1/8" band for a 1/16" bit: 0.04 mm/tooth in hardwood, so F960
  // at 12,000 RPM. Interpolated between 1.5 and 3.175 mm it is 0.0211: F510.
  it('sends a 1/16" hardwood recipe at the interpolated chip load', () => {
    const tool = DEFAULT_CNC_MACHINE_CONFIG.tools.find((candidate) => candidate.id === 'em-1588');
    if (tool === undefined) throw new Error('starter 1/16" bit missing');
    const patch = resolveCncMaterialFeedPatch({
      profile: createProject().device,
      tool,
      materialKey: 'hardwood',
      spindleRpm: 12000,
      machineSpindleMaxRpm: 12000,
      fluteCount: 2,
      ignoreMachineStarter: true,
    });
    if (patch === null) throw new Error('expected a material recipe');
    const gcode = emitGcode(project({ ...patch, toolId: 'em-1588', depthMm: 1 })).gcode;

    const feeds = new Set(cutFeeds(gcode));
    expect([...feeds]).toEqual([510]);
    expect(510 / (12000 * 2)).toBeCloseTo(0.02125, 5);
    expect(gcode).toContain('M3 S12000');
  });
});

describe('depth guide (JR-5)', () => {
  it('warns when a pass is deeper than the bit is wide and the cut passes three diameters', () => {
    const subject = project({ toolId: 'em-3175', depthMm: 19, depthPerPassMm: 4 });
    const depths = cutDepths(emitGcode(subject).gcode);
    expect(Math.min(...depths)).toBe(-19);
    expect(depths).toContain(-4);

    const warnings = reviewWarnings(subject);
    expect(warnings).toContain(
      'Layer "Part" takes 4 mm per pass with a 3.175 mm bit, more than its diameter. The usual ' +
        'guide is up to half the diameter per pass in wood and less in harder materials; a ' +
        'deeper pass overloads the bit and can snap it.',
    );
    expect(
      warnings.some((w) => w.startsWith('Layer "Part" cuts 19 mm deep with a 3.175 mm bit')),
    ).toBe(true);
  });

  it('leaves the flute check to the reach review once the bit records a flute length', () => {
    const tools = DEFAULT_CNC_MACHINE_CONFIG.tools.map((tool) =>
      tool.id === 'em-3175' ? { ...tool, fluteLengthMm: 22 } : tool,
    );
    const warnings = reviewWarnings(
      project({ toolId: 'em-3175', depthMm: 19, depthPerPassMm: 1.5 }, tools),
    );
    expect(warnings.some((w) => w.includes('more than three times its diameter'))).toBe(false);
    expect(warnings.some((w) => w.includes('more than its diameter'))).toBe(false);
  });

  it('is quiet for a shallow cut at half the diameter per pass', () => {
    const warnings = reviewWarnings(
      project({ toolId: 'em-3175', depthMm: 6, depthPerPassMm: 1.5 }),
    );
    expect(warnings.some((w) => w.includes('more than three times its diameter'))).toBe(false);
    expect(warnings.some((w) => w.includes('more than its diameter'))).toBe(false);
  });
});

describe('low chip load from a capped recipe (FS-2)', () => {
  // The 4040 starter cap sends 1/4" MDF at F300 and S12000: 0.0125 mm/tooth,
  // 11% of the chart's 0.11.
  it('names a chart recipe whose sent chip load is under half the chart value', () => {
    const subject = project({
      toolId: 'em-6350',
      depthMm: 3,
      depthPerPassMm: 0.75,
      feedMmPerMin: 300,
      plungeMmPerMin: 120,
      spindleRpm: 12000,
      materialKey: 'plywood-mdf',
      feedSource: { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 2 },
    });
    const gcode = emitGcode(subject).gcode;
    expect(new Set(cutFeeds(gcode))).toEqual(new Set([300]));
    expect(gcode).toContain('M3 S12000');

    const warning = reviewWarnings(subject).find((w) => w.includes('rubs instead of cutting'));
    expect(warning).toContain('Layer "Part" cuts at 0.0125 mm/tooth, 11% of the 0.1100 mm/tooth');
  });

  it('is quiet for a recipe at its chart chip load, and for hand-set values', () => {
    const atChart = project({
      toolId: 'em-6350',
      depthMm: 3,
      depthPerPassMm: 1.5,
      feedMmPerMin: 2640,
      spindleRpm: 12000,
      feedSource: { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 2 },
    });
    const manual = project({ toolId: 'em-6350', depthMm: 3, feedMmPerMin: 300, spindleRpm: 12000 });
    expect(reviewWarnings(atChart).some((w) => w.includes('rubs instead of cutting'))).toBe(false);
    expect(reviewWarnings(manual).some((w) => w.includes('rubs instead of cutting'))).toBe(false);
  });
});
