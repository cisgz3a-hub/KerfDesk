import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  GRBL_GCODE_DIALECTS,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../core/devices';
import { compileJob } from '../../core/job';
import { blockTime, planVelocities, type Block } from '../../core/motion-planner';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { detectJobIntentWarnings } from './job-intent-warnings';

// ADR-257 Amendment 3 (rolling audit v9 R2-P2-3): Island Fill rows get the
// constant-power advice at every overscan, by their own lengths and runways.

const GRBL_COMPATIBLE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'grbl-v1.1',
  gcodeDialect: { dialectId: 'grbl-compatible' },
};
const GRBL_DYNAMIC: DeviceProfile = {
  ...GRBL_COMPATIBLE,
  gcodeDialect: { dialectId: 'grbl-dynamic' },
};
const COLOR = '#ff0000';
const PLANNER_BLOCKS = 15;

// Bars 3 mm tall, each its own island: the audit's stand-in for small text.
function bars(widths: ReadonlyArray<number>, gapMm: number): SceneObject {
  let x = 20;
  const polylines = widths.map((width) => {
    const points = [
      { x, y: 20 },
      { x: x + width, y: 20 },
      { x: x + width, y: 23 },
      { x, y: 23 },
    ];
    x += width + gapMm;
    return { points, closed: true };
  });
  return {
    kind: 'imported-svg',
    id: 'bars',
    source: 'bars.svg',
    bounds: { minX: 20, minY: 20, maxX: x, maxY: 23 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines }],
  };
}

type Case = { readonly strokeMm: number; readonly speed: number; readonly layer: Partial<Layer> };

function fillProject(
  device: DeviceProfile,
  patch: Partial<Layer>,
  widths: number[],
  gapMm = 2,
): Project {
  const layer = {
    ...createLayer({ id: COLOR, name: 'Small text', color: COLOR, mode: 'fill' }),
    fillStyle: 'island' as const,
    ...patch,
  };
  return { ...createProject(device), scene: { objects: [bars(widths, gapMm)], layers: [layer] } };
}

function caseProject(device: DeviceProfile, testCase: Case): Project {
  const widths = Array.from({ length: 6 }, () => testCase.strokeMm);
  return fillProject(device, { speed: testCase.speed, ...testCase.layer }, widths);
}

function allWarnings(project: Project): ReadonlyArray<string> {
  return detectJobIntentWarnings(project, compileJob(project.scene, project.device));
}

function advice(project: Project): ReadonlyArray<string> {
  return allWarnings(project).filter((warning) => warning.includes('constant power (M3)'));
}

/**
 * The dose the emitted program gets, against what its feed would give: mean
 * over the ink of feed / head speed. It reads the real G-code and plans it with
 * the shipped forward and backward passes, but blends G0 into G1 as GRBL's
 * planner does; the time estimate keeps a conservative stop there.
 */
function modelDose(project: Project): number {
  const { gcode } = emitGcode(project);
  const { accelMmPerSec2: accel, junctionDeviationMm: jd, maxFeed } = project.device;
  const blocks = programBlocks(gcode, maxFeed);
  const plan = planVelocities(blocks, accel, jd, PLANNER_BLOCKS);
  let inkDose = 0;
  let inkMm = 0;
  blocks.forEach((block, index) => {
    const entry = plan[index];
    if (block.kind !== 'cut' || entry === undefined) return;
    inkDose += blockTime(block, entry.entryV, entry.exitV, accel) * block.targetVelocity;
    inkMm += block.distance;
  });
  return inkDose / inkMm;
}

function gcodeWord(line: string, letter: string): number | null {
  const found = new RegExp(`${letter}(-?\\d+(?:\\.\\d+)?)`).exec(line);
  return found === null ? null : Number(found[1]);
}

function programBlocks(gcode: string, maxFeed: number): Block[] {
  const blocks: Block[] = [];
  let head = { x: 0, y: 0 };
  let feed = 0;
  for (const line of gcode.split(/\r?\n/)) {
    if (!/^G[01]\b/.test(line)) continue;
    feed = gcodeWord(line, 'F') ?? feed;
    const target = { x: gcodeWord(line, 'X') ?? head.x, y: gcodeWord(line, 'Y') ?? head.y };
    const distance = Math.hypot(target.x - head.x, target.y - head.y);
    const rapid = line.startsWith('G0');
    if (distance > 0) {
      blocks.push({
        kind: !rapid && (gcodeWord(line, 'S') ?? 0) > 0 ? 'cut' : 'travel',
        motion: 'feed',
        distance,
        targetVelocity: (rapid ? maxFeed : feed) / 60,
        direction: { x: (target.x - head.x) / distance, y: (target.y - head.y) / distance },
      });
    }
    head = target;
  }
  return blocks;
}

function quoted(text: string, pattern: RegExp): number | null {
  const found = pattern.exec(text);
  return found === null ? null : Number(found[1]);
}

// The last speed quoted is the one that holds without touching Overscan.
function lastQuotedSpeed(text: string): number {
  const speeds = [...text.matchAll(/lower the speed to about (\d+) mm\/min/g)];
  return Number(speeds[speeds.length - 1]?.[1]);
}

describe('the dose model reproduces the audit and refuter tables', () => {
  // The refuter's table, to its two decimals: stroke, overscan, 1500 / 3000 / 6000.
  const table: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [0.3, 5, 1.64, 3.29, 6.58],
    [1, 5, 1.01, 1.84, 3.67],
    [3, 5, 1, 1.08, 2.13],
    [0.3, 0, 3.09, 6.17, 12.34],
    [1, 0, 1.92, 3.83, 7.66],
    [6, 0, 1.15, 1.72, 3.43],
    [3, 1, 1, 1.22, 2.44],
    [6, 1, 1, 1.11, 2.1],
  ];
  it.each(table)(
    '%s mm strokes at %s mm overscan',
    (strokeMm, overscan, at1500, at3000, at6000) => {
      const dose = (speed: number) =>
        modelDose(
          caseProject(GRBL_COMPATIBLE, { strokeMm, speed, layer: { fillOverscanMm: overscan } }),
        );
      expect(dose(1500)).toBeCloseTo(at1500, 1);
      expect(dose(3000)).toBeCloseTo(at3000, 1);
      expect(dose(6000)).toBeCloseTo(at6000, 1);
    },
  );
});

describe('GRBL Compatible Island Fill gets constant-power advice (R2-P2-3)', () => {
  const overscans: ReadonlyArray<readonly [string, Partial<Layer>]> = [
    ['0 mm', { fillOverscanMm: 0 }],
    ['1 mm', { fillOverscanMm: 1 }],
    ['5 mm', { fillOverscanMm: 5 }],
    ['Automatic', { autoOverscan: true }],
  ];
  const combinations = overscans.flatMap(([label, layer]) =>
    [1500, 6000].map((speed) => [label, speed, layer] as const),
  );

  it.each(combinations)('0.3 mm strokes, overscan %s, %s mm/min', (_label, speed, layer) => {
    const project = caseProject(GRBL_COMPATIBLE, { strokeMm: 0.3, speed, layer });
    expect(modelDose(project)).toBeGreaterThan(1.5);
    const result = advice(project);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Fill operation "Small text" burns with constant power (M3)');
    expect(result[0]).toContain('The shortest row is 0.3 mm');
    expect(result[0]).toContain('choose GRBL Dynamic in Machine Setup');
  });

  it('fires at overscan 1 mm on 3 mm strokes, the path the heat notice never reached', () => {
    const project = caseProject(GRBL_COMPATIBLE, {
      strokeMm: 3,
      speed: 6000,
      layer: { fillOverscanMm: 1 },
    });
    expect(modelDose(project)).toBeCloseTo(2.44, 1);
    const [warning] = advice(project);
    expect(warning).toContain('has 1 mm of laser-off runway at each end');
    expect(warning).toContain('reaches the ink at about 1897 mm/min');
    expect(warning).toContain('raise Overscan to about 1.5 mm and lower the speed to about 2323');
    expect(warning).toContain('or lower the speed to about 1897 mm/min');
  });

  it('says no speed holds at overscan 0, and what does', () => {
    const [warning] = advice(
      caseProject(GRBL_COMPATIBLE, { strokeMm: 0.3, speed: 1500, layer: { fillOverscanMm: 0 } }),
    );
    expect(warning).toContain('no laser-off runway because Overscan is 0');
    expect(warning).toContain('starts and stops on the ink');
    expect(warning).toContain('raise Overscan to about 0.2 mm and lower the speed to about 734');
    expect(warning).not.toContain(', or lower the speed');
  });

  it('asks only for more Overscan where the row has room to reach the feed', () => {
    const [warning] = advice(
      caseProject(GRBL_COMPATIBLE, { strokeMm: 20, speed: 1500, layer: { fillOverscanMm: 0 } }),
    );
    expect(warning).toContain('there, raise Overscan to about 0.7 mm.');
    const raised = caseProject(GRBL_COMPATIBLE, {
      strokeMm: 20,
      speed: 1500,
      layer: { fillOverscanMm: 0.7 },
    });
    expect(advice(raised)).toEqual([]);
    expect(modelDose(raised)).toBeCloseTo(1, 3);
  });

  it('only a lower speed helps a row whose runway is already half its length', () => {
    const [warning] = advice(
      caseProject(GRBL_COMPATIBLE, { strokeMm: 0.3, speed: 6000, layer: {} }),
    );
    expect(warning).toContain('has 0.15 mm of laser-off runway');
    expect(warning).toContain('lower the speed to about 734 mm/min');
    expect(warning).not.toContain('raise Overscan');
  });

  // The speed the advice quotes must be one the model holds at dose 1.000.
  it.each([
    [0.3, { fillOverscanMm: 5 }],
    [1, { fillOverscanMm: 5 }],
    [3, { fillOverscanMm: 5 }],
    [3, { fillOverscanMm: 1 }],
    [6, { fillOverscanMm: 1 }],
    [0.3, { autoOverscan: true }],
  ] as const)('holds %s mm strokes at the speed it quotes (%o)', (strokeMm, layer) => {
    const [warning] = advice(caseProject(GRBL_COMPATIBLE, { strokeMm, speed: 6000, layer }));
    const speed = lastQuotedSpeed(warning ?? '');
    const held = caseProject(GRBL_COMPATIBLE, { strokeMm, speed, layer });
    expect(modelDose(held)).toBeCloseTo(1, 3);
    expect(advice(held)).toEqual([]);
  });

  it.each([0.3, 1, 6])(
    'holds %s mm strokes on the Overscan it quotes at overscan 0',
    (strokeMm) => {
      const [warning] = advice(
        caseProject(GRBL_COMPATIBLE, { strokeMm, speed: 6000, layer: { fillOverscanMm: 0 } }),
      );
      const text = warning ?? '';
      const overscan = quoted(text, /raise Overscan to about ([\d.]+) mm/);
      const speed = quoted(text, /and lower the speed to about (\d+) mm\/min/);
      expect(overscan).not.toBeNull();
      expect(speed).not.toBeNull();
      const held = caseProject(GRBL_COMPATIBLE, {
        strokeMm,
        speed: speed ?? 0,
        layer: { fillOverscanMm: overscan ?? 0 },
      });
      expect(modelDose(held)).toBeCloseTo(1, 3);
      expect(advice(held)).toEqual([]);
    },
  );

  it('gives one advisory per operation, quoting its tightest row', () => {
    const project = fillProject(GRBL_COMPATIBLE, { speed: 6000 }, [0.3, 0.5, 0.8, 1.3, 2.1, 3]);
    expect(compileJob(project.scene, project.device).groups.length).toBeGreaterThan(1);
    const result = advice(project);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('The shortest row is 0.3 mm');
    expect(result[0]).toContain('lower the speed to about 734 mm/min');
  });

  it("reaches grblHAL and FluidNC, whose deeper planners don't lengthen a runway", () => {
    const testCase = { strokeMm: 0.3, speed: 1500, layer: {} };
    const grblHal = { ...GRBL_COMPATIBLE, controllerKind: 'grblhal' as const };
    expect(advice(caseProject(grblHal, testCase))[0]).toContain('grblHAL supports dynamic power');
    const fluidNc = { ...GRBL_COMPATIBLE, controllerKind: 'fluidnc' as const };
    expect(advice(caseProject(fluidNc, testCase))[0]).toContain('FluidNC supports dynamic power');
  });
});

describe('controls: what must not change', () => {
  it('stays quiet where the runway reaches the feed', () => {
    for (const layer of [{ fillOverscanMm: 5 }, { autoOverscan: true }]) {
      const project = caseProject(GRBL_COMPATIBLE, { strokeMm: 3, speed: 1500, layer });
      expect(modelDose(project)).toBeCloseTo(1, 3);
      expect(advice(project)).toEqual([]);
    }
    // Automatic goes quiet on a row long enough to carry its runway.
    const longRow = caseProject(GRBL_COMPATIBLE, {
      strokeMm: 30,
      speed: 6000,
      layer: { autoOverscan: true },
    });
    expect(modelDose(longRow)).toBeCloseTo(1, 3);
    expect(advice(longRow)).toEqual([]);
    const oneMm = { fillOverscanMm: 1 };
    const atOne = caseProject(GRBL_COMPATIBLE, { strokeMm: 6, speed: 1500, layer: oneMm });
    expect(modelDose(atOne)).toBeCloseTo(1, 3);
    expect(advice(atOne)).toEqual([]);
  });

  it('gives no dose advice under GRBL Dynamic (M4), at any overscan or speed', () => {
    for (const layer of [
      { fillOverscanMm: 0 },
      { fillOverscanMm: 1 },
      { fillOverscanMm: 5 },
      { autoOverscan: true },
    ]) {
      for (const speed of [1500, 6000]) {
        const project = caseProject(GRBL_DYNAMIC, { strokeMm: 0.3, speed, layer });
        expect(advice(project)).toEqual([]);
      }
    }
  });

  it('keeps the generic heat notice under M4, word for word', () => {
    const project = caseProject(GRBL_DYNAMIC, {
      strokeMm: 0.3,
      speed: 1500,
      layer: { fillOverscanMm: 5 },
    });
    const count = compileJob(project.scene, project.device).groups.flatMap((group) =>
      group.kind === 'fill' ? group.segments : [],
    ).length;
    expect(allWarnings(project)).toContain(
      `Island Fill has ${count} short sweep(s) that need partial acceleration runway. KerfDesk will add capped laser-off runway, but test on scrap if those small islands look darker than the rest.`,
    );
  });

  it('advises exactly the dialects whose default fills with M3: only GRBL Compatible', () => {
    const constant = GRBL_GCODE_DIALECTS.filter((dialect) => dialect.fillPowerMode === 'constant');
    expect(constant.map((dialect) => dialect.id)).toEqual(['grbl-compatible']);
    for (const dialect of GRBL_GCODE_DIALECTS) {
      const device = { ...GRBL_COMPATIBLE, gcodeDialect: { dialectId: dialect.id } };
      const project = caseProject(device, { strokeMm: 0.3, speed: 6000, layer: {} });
      expect(advice(project)).toHaveLength(dialect.fillPowerMode === 'constant' ? 1 : 0);
    }
  });

  it('leaves the 4040 alone: it keeps M3 for Line cuts only', () => {
    const project = caseProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, {
      strokeMm: 0.3,
      speed: 6000,
      layer: {},
    });
    expect(advice(project)).toEqual([]);
  });

  it('says nothing to an operation set to a power mode by hand', () => {
    for (const powerMode of ['constant', 'dynamic'] as const) {
      const project = caseProject(GRBL_COMPATIBLE, {
        strokeMm: 0.3,
        speed: 6000,
        layer: { powerMode },
      });
      expect(advice(project)).toEqual([]);
    }
  });

  // Ordinary Fill: row ends stay Overscan's business (Amendment 2, Decision 1).
  it('leaves ordinary Fill as it was, at every overscan', () => {
    const scanline = (speed: number, layer: Partial<Layer>) =>
      advice(
        caseProject(GRBL_COMPATIBLE, {
          strokeMm: 0.3,
          speed,
          layer: { fillStyle: 'scanline', ...layer },
        }),
      );
    for (const layer of [
      { fillOverscanMm: 0 },
      { fillOverscanMm: 1 },
      { fillOverscanMm: 5 },
      { autoOverscan: true },
    ]) {
      expect(scanline(1500, layer)).toEqual([]);
    }
    const twentyBars = fillProject(
      GRBL_COMPATIBLE,
      { speed: 6000, fillStyle: 'scanline' },
      Array.from({ length: 20 }, () => 0.3),
      0.3,
    );
    expect(advice(twentyBars)).toHaveLength(1);
    expect(advice(twentyBars)[0]).toContain('each stroke a scan line crosses');
  });
});
