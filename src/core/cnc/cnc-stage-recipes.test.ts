import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Scene,
} from '../scene';
import type { CncStageRecipe } from '../scene/cnc-stage-recipe';
import { compileCncJob } from './compile-cnc-job';
import { cncStageRecipe } from './cnc-stage-settings';

const FINE: CncTool = {
  id: 'fine',
  name: 'Fine cutter',
  kind: 'end-mill',
  diameterMm: 3,
  fluteCount: 2,
};
const ROUGH: CncTool = {
  id: 'rough',
  name: 'Rough cutter',
  kind: 'end-mill',
  diameterMm: 6,
  fluteCount: 2,
};
const VBIT: CncTool = { id: 'v', name: 'V bit', kind: 'v-bit', diameterMm: 6, tipAngleDeg: 90 };
const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  toolId: FINE.id,
  tools: [FINE, ROUGH, VBIT],
  params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleSpinupSec: 0 },
};
const RECIPE: CncStageRecipe = {
  toolId: FINE.id,
  feedMmPerMin: 321,
  plungeMmPerMin: 123,
  spindleRpm: 9000,
  depthPerPassMm: 0.5,
};
function scene(patch: Partial<CncLayerSettings>, parts = 1): Scene {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'drawing',
    source: 'parts.svg',
    bounds: { minX: 20, minY: 20, maxX: 90, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: Array.from({ length: parts }, (_, index) => ({
          closed: true,
          points: [
            { x: 20 + 40 * index, y: 20 },
            { x: 40 + 40 * index, y: 20 },
            { x: 40 + 40 * index, y: 40 },
            { x: 20 + 40 * index, y: 40 },
          ],
        })),
      },
    ],
  };
  return {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'cut', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          tabsEnabled: false,
          toolId: FINE.id,
          feedMmPerMin: 900,
          plungeMmPerMin: 200,
          spindleRpm: 12000,
          depthMm: 2,
          depthPerPassMm: 1,
          profileLead: { shape: 'none' },
          ...patch,
        },
      },
    ],
  };
}

describe('independent CNC stage cutting recipes', () => {
  it.each([
    { profileLead: { shape: 'none' as const } },
    { profileLead: { shape: 'arc' as const } },
    { rampEntryDeg: 3 },
    { tabsEnabled: true },
  ])('preserves part order and finish values through entry transforms %j', (entry) => {
    const job = compileCncJob(
      scene(
        {
          cutType: 'profile-outside',
          finishAllowanceMm: 0.2,
          stageRecipes: { 'profile-finish': RECIPE },
          ...entry,
        },
        2,
      ),
      DEFAULT_DEVICE_PROFILE,
      { ...MACHINE, stock: { ...MACHINE.stock, thicknessMm: 2 } },
    );
    const groups = job.groups.filter((group) => group.kind === 'cnc');
    expect(groups.map((group) => group.feedMmPerMin)).toEqual([900, 321, 900, 321]);
    expect(groups.map((group) => group.passes.length)).toEqual([2, 4, 2, 4]);
    expect(groups.map((group) => group.spindleRpm)).toEqual([12000, 9000, 12000, 9000]);
    expect(groups[1]?.plungeMmPerMin).toBe(123);
    expect(groups[1]?.depthPerPassMm).toBe(0.5);
    expect(JSON.stringify(job)).not.toContain('profileFinishStage');
    const output = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(output).toContain('F321');
    expect(output).toContain('F123');
    expect(output.match(/^M3 S\d+/gm)).toEqual(['M3 S12000', 'M3 S9000', 'M3 S12000', 'M3 S9000']);
    expect(output).not.toMatch(/^M0(?:\s|$)/m);
  });
  it('uses the secondary pocket cutter recipe for both its depth ladder and emitted values', () => {
    const job = compileCncJob(
      scene({
        cutType: 'pocket',
        pocketRoughToolId: ROUGH.id,
        stageRecipes: { 'pocket-rough': { ...RECIPE, toolId: ROUGH.id } },
      }),
      DEFAULT_DEVICE_PROFILE,
      MACHINE,
    );
    const groups = job.groups.filter((group) => group.kind === 'cnc');
    expect(groups[0]).toMatchObject({
      toolId: ROUGH.id,
      feedMmPerMin: 321,
      spindleRpm: 9000,
      depthPerPassMm: 0.5,
    });
    expect(groups[1]).toMatchObject({ toolId: FINE.id, feedMmPerMin: 900, spindleRpm: 12000 });
    expect(
      new Set(groups[0]?.passes.flatMap((pass) => (pass.kind === 'contour' ? [pass.zMm] : []))),
    ).toEqual(new Set([-0.5, -1, -1.5, -2]));
  });
  it('uses the V clearing cutter recipe while retaining the V cutter recipe', () => {
    const job = compileCncJob(
      scene({
        cutType: 'v-carve',
        toolId: VBIT.id,
        vCarveFlatDepthEnabled: true,
        vClearToolId: FINE.id,
        stageRecipes: { 'v-clear': RECIPE },
      }),
      DEFAULT_DEVICE_PROFILE,
      MACHINE,
    );
    const groups = job.groups.filter((group) => group.kind === 'cnc');
    expect(groups[0]).toMatchObject({
      toolId: FINE.id,
      feedMmPerMin: 321,
      spindleRpm: 9000,
      depthPerPassMm: 0.5,
    });
    expect(groups[1]).toMatchObject({ toolId: VBIT.id, feedMmPerMin: 900, spindleRpm: 12000 });
  });
  it('does not reuse another cutter’s recipe or alter legacy full-depth finishing', () => {
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      stageRecipes: { 'profile-finish': { ...RECIPE, toolId: 'other' } },
    };
    expect(cncStageRecipe(settings, 'profile-finish', FINE)).toBeUndefined();
    const job = compileCncJob(
      scene({
        cutType: 'profile-outside',
        finishAllowanceMm: 0.2,
        stageRecipes: settings.stageRecipes,
      }),
      DEFAULT_DEVICE_PROFILE,
      MACHINE,
    );
    expect(job.groups).toHaveLength(1);
    expect(job.groups[0]).toMatchObject({ feedMmPerMin: 900, spindleRpm: 12000 });
    expect(job.groups[0]?.kind === 'cnc' && job.groups[0].passes.length).toBe(3);
  });
});
