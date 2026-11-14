// CNC audit v3 N7r-P3-1 and N7r-P3-2, both from #1897 (ADR-256 Amendment 1):
// the 4040 starter's 500 W spindle has a 3,000 RPM floor. Job Review must not
// advise going below it and must name a hand-set S under it; the card's side
// doors must not treat the starter's lowered 3,000 RPM as hand-set.
import { describe, expect, it } from 'vitest';
import { resolveCncAutoLayerSettings } from '../../core/cnc/machine-starters';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import type { DeviceProfile } from '../../core/devices';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncMachineConfig,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { detectCncMachineLimitWarnings } from '../laser/cnc-machine-limit-warnings';
import { detectMachineJobWarnings } from '../laser/machine-job-warnings';
import {
  keptFeedsMaterialPatch,
  stageMaterialStarterPatch,
} from '../layers/cnc-material-starter-patches';
import { layerWithCncMaterial } from './cnc-project-material';

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

const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 25 },
};
const PROFILE = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;

function project(cnc: CncLayerSettings, device: DeviceProfile = PROFILE): Project {
  return {
    ...createProject(),
    device,
    machine: MACHINE,
    scene: {
      objects: [PART],
      layers: [
        {
          ...createLayer({ id: 'L', color: '#ff0000', name: 'Part' }),
          cnc: { ...cnc, depthMm: 3 },
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

function starterSeeded(): CncLayerSettings {
  const seeded = resolveCncAutoLayerSettings({ profile: PROFILE, machine: MACHINE });
  if (seeded === null) throw new Error('expected the 4040 starter');
  return seeded;
}

describe('Job Review and the 3,000 RPM floor (N7r-P3-1)', () => {
  it('does not advise a lower spindle speed when the recipe is already at the floor', () => {
    const cnc = layerWithCncMaterial({
      layer: {
        ...createLayer({ id: 'L', color: '#ff0000' }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'em-6350' },
      },
      machine: MACHINE,
      profile: PROFILE,
      materialKey: 'plywood-mdf',
    }).cnc;
    if (cnc === undefined) throw new Error('expected CNC settings');
    const subject = project(cnc);
    expect(emitGcode(subject).gcode).toContain('M3 S3000');

    const warning = reviewWarnings(subject).find((w) => w.includes('rubs instead of cutting'));
    expect(warning).toContain('45% of the 0.1100 mm/tooth');
    expect(warning).toContain('the spindle is already at its 3000 RPM minimum');
    expect(warning).not.toContain('lower the spindle speed');
  });

  it('names a hand-set spindle speed under the floor, with and without a compiled job', () => {
    const subject = project({ ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'em-3175', spindleRpm: 2000 });
    expect(emitGcode(subject).gcode).toContain('M3 S2000');
    const text =
      'Layer "Part" runs the spindle at 2000 RPM, below the 3000 RPM minimum of the spindle ' +
      'this machine profile assumes.';

    expect(reviewWarnings(subject).some((w) => w.startsWith(text))).toBe(true);
    expect(detectCncMachineLimitWarnings(subject, null).some((w) => w.startsWith(text))).toBe(true);
  });

  it('is quiet at the floor, and on a profile whose starter names no minimum', () => {
    const atFloor = project({ ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'em-3175', spindleRpm: 3000 });
    const other = project(
      { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'em-3175', spindleRpm: 2000 },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(reviewWarnings(atFloor).some((w) => w.includes('RPM minimum'))).toBe(false);
    expect(detectCncMachineLimitWarnings(other, null).some((w) => w.includes('minimum'))).toBe(
      false,
    );
  });
});

describe('side doors plan from full speed on a starter-seeded layer (N7r-P3-2)', () => {
  // The audit's case: a starter-seeded 4040 layer at S3000 changes to the 1/16"
  // bit. Treated as hand-set, aluminium came out at S3000 F60; the Material
  // picker gives S12000 F250 (chart 0.0105 mm/tooth at 1.5875 mm).
  const seededOnSmallBit = (): CncLayerSettings => ({ ...starterSeeded(), toolId: 'em-1588' });

  it('"Use <material> values" after a bit change', () => {
    const settings = seededOnSmallBit();
    expect(settings.spindleRpm).toBe(3000);
    const patch = keptFeedsMaterialPatch({
      materialKey: 'aluminum',
      settings,
      machine: MACHINE,
      profile: PROFILE,
      liveCaps: null,
    });
    expect(patch).toMatchObject({ spindleRpm: 12000, feedMmPerMin: 250 });
  });

  it("a stage recipe's material starter running the operation's RPM", () => {
    const settings = seededOnSmallBit();
    const tool = MACHINE.tools.find((candidate) => candidate.id === 'em-1588');
    if (tool === undefined) throw new Error('starter 1/16" bit missing');
    const patch = stageMaterialStarterPatch({
      materialKey: 'aluminum',
      settings,
      stageTool: tool,
      stageSpindleRpm: settings.spindleRpm,
      machine: MACHINE,
      profile: PROFILE,
      liveCaps: null,
    });
    expect(patch).toMatchObject({ spindleRpm: 12000, feedMmPerMin: 250 });
  });

  it('keeps a hand-set 3,000 RPM, and a stage RPM typed apart from the operation', () => {
    const { feedSource: _source, ...manual } = seededOnSmallBit();
    expect(
      keptFeedsMaterialPatch({
        materialKey: 'aluminum',
        settings: manual,
        machine: MACHINE,
        profile: PROFILE,
        liveCaps: null,
      }),
    ).toMatchObject({ spindleRpm: 3000, feedMmPerMin: 60 });
    const tool = MACHINE.tools.find((candidate) => candidate.id === 'em-1588');
    if (tool === undefined) throw new Error('starter 1/16" bit missing');
    expect(
      stageMaterialStarterPatch({
        materialKey: 'aluminum',
        settings: seededOnSmallBit(),
        stageTool: tool,
        stageSpindleRpm: 4000,
        machine: MACHINE,
        profile: PROFILE,
        liveCaps: null,
      }),
    ).toMatchObject({ spindleRpm: 4000 });
  });
});
