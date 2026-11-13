// CNC audit FS-2 (ADR-256 Amendment 1). The maintainer kept the 4040 starter's
// 300 mm/min feed cap and chose to lower RPM to it ("Keep 300, lower RPM"). Each
// case resolves the recipe as the app does, then reads the S and F words of the
// emitted program and the chip load they make.
import { describe, expect, it } from 'vitest';
import { resolveCncAutoLayerSettings } from '../../core/cnc/machine-starters';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
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
  type Layer,
  type Project,
} from '../../core/scene';
import { detectMachineJobWarnings } from '../laser/machine-job-warnings';
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

function layer(cnc: CncLayerSettings): Layer {
  return { ...createLayer({ id: 'L', color: '#ff0000', name: 'Part' }), cnc };
}

function project(cnc: CncLayerSettings): Project {
  return {
    ...createProject(),
    device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    machine: MACHINE,
    scene: { objects: [PART], layers: [layer({ ...cnc, depthMm: 3 })] },
  };
}

// The layer names its bit before the recipe resolves, so the chart value is
// that bit's. A fresh operation starts from the default 12,000 RPM.
function withMaterial(
  materialKey: string,
  toolId: string,
  from: CncLayerSettings = DEFAULT_CNC_LAYER_SETTINGS,
) {
  const next = layerWithCncMaterial({
    layer: layer({ ...from, toolId }),
    machine: MACHINE,
    profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    materialKey,
  }).cnc;
  if (next?.toolId !== toolId) throw new Error('expected CNC settings for the named bit');
  return next;
}

function spindleWords(gcode: string): number[] {
  return [...gcode.matchAll(/^M3 S(\d+)/gm)].map((match) => Number(match[1]));
}

function cutFeeds(gcode: string): number[] {
  return [
    ...new Set(
      gcode
        .split('\n')
        .filter((line) => /^G1\b/.test(line) && /\b[XY]-?\d/.test(line))
        .flatMap((line) => {
          const f = /\bF(\d+(?:\.\d+)?)/.exec(line);
          return f === null ? [] : [Number(f[1])];
        }),
    ),
  ];
}

function sent(cnc: CncLayerSettings) {
  const gcode = emitGcode(project(cnc)).gcode;
  const [rpm] = spindleWords(gcode);
  const feeds = cutFeeds(gcode);
  if (rpm === undefined || feeds.length !== 1) throw new Error('expected one S and one cut F');
  const feed = feeds[0] ?? 0;
  return { rpm, feed, chiploadMm: feed / (rpm * 2) };
}

describe('the 4040 feed cap lowers RPM to the chart chip load (FS-2)', () => {
  it('seeds the starter at 300 mm/min and the spindle minimum, 0.050 mm/tooth', () => {
    const seeded = resolveCncAutoLayerSettings({
      profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      machine: MACHINE,
    });
    expect(seeded).toMatchObject({
      feedMmPerMin: 300,
      spindleRpm: 3000,
      feedSource: { kind: 'machine-starter', revision: 3 },
    });
    if (seeded === null) throw new Error('expected the starter');
    const out = sent(seeded);
    expect(out).toMatchObject({ rpm: 3000, feed: 300 });
    expect(out.chiploadMm).toBeCloseTo(0.05, 5);
  });

  it.each([
    // material, and the RPM at which 300 mm/min meets its 1/8" chart chip load
    ['plywood-mdf', 3000], // 300 / (2 x 0.06) = 2,500, floored at 3,000
    ['hardwood', 3750], // 300 / (2 x 0.04)
    ['aluminum', 7500], // 300 / (2 x 0.02)
  ])('sends a 1/8" %s recipe at S%i and F300', (material, rpm) => {
    const out = sent(withMaterial(material, 'em-3175'));
    expect(out).toMatchObject({ rpm, feed: 300 });
  });

  it('plans from full speed on a starter-seeded layer, so a lowered RPM does not stick', () => {
    const seeded = resolveCncAutoLayerSettings({
      profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      machine: MACHINE,
    });
    if (seeded === null) throw new Error('expected the starter');
    const mdf = withMaterial('plywood-mdf', 'em-3175', seeded);
    expect(mdf.spindleRpm).toBe(3000);
    expect(withMaterial('aluminum', 'em-3175', mdf).spindleRpm).toBe(7500);
  });

  it('keeps a hand-set RPM as the upper bound', () => {
    const manual = { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: 2000 };
    const out = sent(withMaterial('plywood-mdf', 'em-3175', manual));
    expect(out.rpm).toBe(2000);
    expect(out.chiploadMm).toBeCloseTo(0.06, 5); // 240 mm/min, under the cap
  });

  it('still warns when the floor leaves a 1/4" MDF bit under half the chart', () => {
    // 300 / (2 x 0.11) = 1,364 RPM, under the 3,000 floor: 0.050 mm/tooth.
    const cnc = withMaterial('plywood-mdf', 'em-6350');
    const out = sent(cnc);
    expect(out).toMatchObject({ rpm: 3000, feed: 300 });
    // The aluminium chart at 1/4" (0.05) is met at 3,000 RPM exactly.
    expect(sent(withMaterial('aluminum', 'em-6350'))).toMatchObject({ rpm: 3000, feed: 300 });
    const subject = project(cnc);
    const prepared = prepareOutput(subject);
    if (!prepared.ok) throw new Error('expected the job to prepare');
    const warnings = detectMachineJobWarnings(subject, null, null, prepared);
    expect(warnings.find((w) => w.includes('rubs instead of cutting'))).toContain(
      'Layer "Part" cuts at 0.0500 mm/tooth, 45% of the 0.1100 mm/tooth',
    );
  });
});
