import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncPassXyPoints, type CncGroup, type CncPass } from '../job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type CncTool,
  type Polyline,
} from '../scene';
import { DEFAULT_CNC_TAPERED_INLAY } from '../scene/cnc-tapered-inlay';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { compileTaperedInlayOperation } from './tapered-inlay-operation';
import { compiledInlayGroups } from './compile-cnc-operation-groups';

const TOOL: CncTool = {
  id: 'v60',
  name: 'Test pointed V60',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 60,
};
const CONFIG = { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [TOOL], toolId: TOOL.id };
const INTENT = {
  ...DEFAULT_CNC_TAPERED_INLAY,
  pocketDepthMm: 0.7,
  engagementDepthMm: 0.5,
  glueGapMm: 0.2,
  surfaceClearanceMm: 0.3,
  plugBorderMm: 1,
};
const SETTINGS = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  cutType: 'inlay-pair' as const,
  toolId: TOOL.id,
  depthPerPassMm: 0.25,
  vResolutionMm: 0.1,
  taperedInlay: INTENT,
};
const SOURCE: Polyline[] = [
  {
    closed: true,
    points: [
      { x: 10, y: 10 },
      { x: 16, y: 10 },
      { x: 16, y: 16 },
      { x: 10, y: 16 },
    ],
  },
];
function depths(pass: CncPass): ReadonlyArray<number> {
  if (pass.kind === 'path3d') return pass.points.map((point) => point.z);
  if (pass.kind === 'helical-contour') return [pass.startZMm, pass.zMm];
  return [pass.zMm];
}
function pair(settings = SETTINGS): { female: CncGroup; male: CncGroup } {
  const result = compiledInlayGroups(
    createLayer({ id: 'pair', color: '#000000' }),
    settings,
    SOURCE,
    DEFAULT_DEVICE_PROFILE,
    CONFIG,
  );
  if (result?.groups === null || result === null) throw new Error('Missing pair output');
  return result.groups;
}

describe('tapered V-bit pair output', () => {
  it('carves the waste around the retained plug with the same V-bit, no profile lead or release tabs', () => {
    const { female, male } = pair();
    expect(female.pairedInlay).toEqual({
      kind: 'tapered-v',
      piece: 'pocket',
      pairId: 'pair',
      settings: INTENT,
    });
    expect(male.pairedInlay).toEqual({
      kind: 'tapered-v',
      piece: 'plug',
      pairId: 'pair',
      settings: INTENT,
    });
    expect(female.cutType).toBe('v-carve');
    expect(male.cutType).toBe('v-carve');
    expect(female.toolId).toBe(TOOL.id);
    expect(male.toolId).toBe(TOOL.id);
    expect(Math.min(...female.passes.flatMap(depths))).toBeCloseTo(-0.7, 3);
    expect(Math.min(...male.passes.flatMap(depths))).toBeCloseTo(-0.8, 3);
    expect(
      Math.min(...male.passes.flatMap(cncPassXyPoints).map((point) => point.x)),
    ).toBeGreaterThan(16);
    const emitted = cncGrblStrategy.emit({ groups: [female, male] }, DEFAULT_DEVICE_PROFILE);
    expect(emitted).toContain('Z-0.700');
    expect(emitted).toContain('Z-0.800');
    expect(emitted).not.toContain('M0');
  });

  it('shifts both cutting planes in exact generated XYZ, independently of engagement', () => {
    const moved = {
      ...SETTINGS,
      taperedInlay: { ...INTENT, pocketStartDepthMm: 0.4, plugStartDepthMm: 0.9 },
    };
    const result = compileTaperedInlayOperation(SOURCE, moved, CONFIG);
    if (result.operation === null) throw new Error(result.findings.join('; '));
    expect(result.findings.join(' ')).toContain('already been removed');
    expect(Math.min(...result.operation.femalePasses.flatMap(depths))).toBeCloseTo(-1.1, 3);
    expect(Math.min(...result.operation.malePasses.flatMap(depths))).toBeCloseTo(-1.7, 3);
    expect(Math.max(...result.operation.femalePasses.flatMap(depths))).toBeLessThanOrEqual(-0.4);
    expect(Math.max(...result.operation.malePasses.flatMap(depths))).toBeLessThanOrEqual(-0.9);
  });

  it('regenerates both pieces from an edited source and preserves explicit cutting values', () => {
    const original = compileTaperedInlayOperation(SOURCE, SETTINGS, CONFIG);
    const edited = compileTaperedInlayOperation(
      SOURCE.map((contour) => ({
        ...contour,
        points: contour.points.map((point) => ({ ...point, x: point.x * 1.2 })),
      })),
      SETTINGS,
      CONFIG,
    );
    expect(edited.operation?.femalePasses).not.toEqual(original.operation?.femalePasses);
    expect(edited.operation?.malePasses).not.toEqual(original.operation?.malePasses);
    expect(edited.operation?.maleSettings.feedMmPerMin).toBe(SETTINGS.feedMmPerMin);
    expect(edited.operation?.femaleSettings.depthPerPassMm).toBe(0.25);
  });
});
