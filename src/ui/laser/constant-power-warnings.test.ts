import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../core/devices';
import { compileJob, type Job, type RasterGroup } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import {
  constantPowerWarnings,
  lookAheadSpeedMmPerSec,
  squareCornerSpeedMmPerSec,
} from './constant-power-warnings';
import { detectJobIntentWarnings } from './job-intent-warnings';

// ADR-257 Amendment 1 (quality audit Q1-P2-1, Q6-P2-1) and Amendment 2
// (rolling audit v8 N8-P2-5).

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

function projectFor(device: DeviceProfile, layer: Layer, objects: SceneObject[] = []): Project {
  return { ...createProject(device), scene: { objects, layers: [layer] } };
}

// A 20 mm row of 200 pixels: 0.1 mm per pixel, the audit's Jarvis wedge.
function raster(patch: Partial<RasterGroup> = {}): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'image',
    source: 'face.png',
    color: '#000000',
    power: 50,
    speed: 6000,
    passes: 1,
    airAssist: false,
    sValues: new Float64Array(200 * 4).fill(500),
    pixelWidth: 200,
    pixelHeight: 4,
    bounds: { minX: 10, minY: 10, maxX: 30, maxY: 10.4 },
    overscanMm: 11,
    dotWidthCorrectionMm: 0,
    ...patch,
  };
}

function imageWarnings(
  device: DeviceProfile,
  group: RasterGroup = raster(),
): ReadonlyArray<string> {
  const layer = createLayer({ id: 'image', name: 'Photo', color: '#000000', mode: 'image' });
  return constantPowerWarnings({ groups: [group] }, projectFor(device, layer));
}

function square(): SceneObject {
  const points = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
  ];
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines: [{ points, closed: true }] }],
  };
}

function lineProject(device: DeviceProfile, patch: Partial<Layer> = {}): Project {
  return projectFor(
    device,
    { ...createLayer({ id: COLOR, name: 'Outline', color: COLOR }), ...patch },
    [square()],
  );
}

function lineWarnings(project: Project, job: Job = compileJob(project.scene, project.device)) {
  return constantPowerWarnings(job, project);
}

describe('the planner models behind the advice', () => {
  it("reproduces the audit's look-ahead speed: 15 blocks, 500 mm/s², 0.1 mm moves", () => {
    expect(lookAheadSpeedMmPerSec(500, 15, 0.1)).toBeCloseTo(37.42, 2);
    // grblHAL's 100 blocks, as ADR-525 records: 99.5 mm/s.
    expect(lookAheadSpeedMmPerSec(500, 100, 0.1)).toBeCloseTo(99.5, 1);
  });

  it("reproduces the refuter's square-corner junction speed: 4.13 mm/s", () => {
    expect(squareCornerSpeedMmPerSec(500, 0.01)).toBeCloseTo(4.13, 2);
  });

  // ADR-675: CoreXY plans the corner in motor space, so v² = a·δ·(1 + √2) / 2.
  it('slows a CoreXY square corner to 2.46 mm/s at the same settings', () => {
    expect(squareCornerSpeedMmPerSec(500, 0.01, 'corexy')).toBeCloseTo(2.46, 2);
    expect(squareCornerSpeedMmPerSec(500, 0.01, 'cartesian')).toBeCloseTo(4.13, 2);
  });
});

describe('constant-power (M3) image advice (Q1-P2-1)', () => {
  it('warns for a GRBL Compatible image whose dense rows outrun the look-ahead', () => {
    const result = imageWarnings(GRBL_COMPATIBLE);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Image "face.png" on "Photo" burns with constant power (M3)');
    expect(result[0]).toContain('every 0.1 mm pixel');
    expect(result[0]).toContain('holds such rows to about 2244 mm/min');
    expect(result[0]).toContain('darker than the Preview shows');
    expect(result[0]).toContain('If the controller runs GRBL 1.1f or newer, choose GRBL Dynamic');
    expect(result[0]).toContain('lower the speed to about 2244 mm/min');
  });

  it('stays quiet where the look-ahead keeps the programmed feed', () => {
    expect(imageWarnings(GRBL_COMPATIBLE, raster({ speed: 2200 }))).toEqual([]);
    // 1 mm pixels: 15 blocks hold 118 mm/s, above 6000 mm/min.
    expect(
      imageWarnings(
        GRBL_COMPATIBLE,
        raster({ bounds: { minX: 10, minY: 10, maxX: 210, maxY: 10.4 } }),
      ),
    ).toEqual([]);
  });

  it('does not appear for dialects that burn images with dynamic power (M4)', () => {
    expect(imageWarnings(GRBL_DYNAMIC)).toEqual([]);
    expect(
      imageWarnings({ ...GRBL_COMPATIBLE, gcodeDialect: { dialectId: 'grbl-raster' } }),
    ).toEqual([]);
    expect(imageWarnings(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)).toEqual([]);
  });

  it("uses grblHAL's deeper planner and names its dynamic power", () => {
    const grblHal = { ...GRBL_COMPATIBLE, controllerKind: 'grblhal' as const };
    expect(imageWarnings(grblHal, raster({ speed: 5900 }))).toEqual([]);
    const result = imageWarnings(grblHal);
    expect(result[0]).toContain('holds about 100 moves');
    expect(result[0]).toContain('grblHAL supports dynamic power');
  });

  it('leaves CNC, Marlin and Smoothieware output alone', () => {
    const layer = createLayer({ id: 'image', mode: 'image', color: '#000000' });
    const cnc = { ...projectFor(GRBL_COMPATIBLE, layer), machine: DEFAULT_CNC_MACHINE_CONFIG };
    expect(constantPowerWarnings({ groups: [raster()] }, cnc)).toEqual([]);
    expect(imageWarnings({ ...GRBL_COMPATIBLE, controllerKind: 'marlin' })).toEqual([]);
    expect(imageWarnings({ ...GRBL_COMPATIBLE, controllerKind: 'smoothieware' })).toEqual([]);
  });
});

describe('constant-power (M3) Line advice (Q6-P2-1)', () => {
  it('warns for GRBL Compatible Line cuts: corners, starts and ends', () => {
    const result = lineWarnings(lineProject(GRBL_COMPATIBLE));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Line operation "Outline" burns with constant power (M3)');
    expect(result[0]).toContain('square corner at about 4.1 mm/s, against 25 mm/s along the line');
    expect(result[0]).toContain('so corners, path starts and path ends burn darker');
    expect(result[0]).toContain('choose GRBL Dynamic in Machine Setup');
    expect(result[0]).toContain('Lead-in / Lead-out');
  });

  it('warns for 4040 Line cuts about corners, with runways at both ends', () => {
    const result = lineWarnings(lineProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('as the Neotronics 4040 Safe dialect does for cuts');
    expect(result[0]).toContain('so corners burn darker');
    expect(result[0]).toContain('Laser-off runways carry the head through path starts and ends');
    expect(result[0]).toContain("Set this operation's Power mode to Dynamic (M4)");
    expect(result[0]).not.toContain('Machine Setup');
  });

  it('says the 4040 starts and ends burn darker when the runways are skipped', () => {
    const project = lineProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const job = { ...compileJob(project.scene, project.device), contourEntryBounds: null };
    const [warning] = lineWarnings(project, job);
    expect(warning).toContain('so corners, path starts and path ends burn darker');
    expect(warning).toContain('skipped because the bed position is unknown');
    expect(warning).toContain('home the machine');
  });

  it('does not appear for M4 dialects or an operation set to a power mode by hand', () => {
    expect(lineWarnings(lineProject(GRBL_DYNAMIC))).toEqual([]);
    const fourForty = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;
    expect(lineWarnings(lineProject(fourForty, { powerMode: 'dynamic' }))).toEqual([]);
    expect(lineWarnings(lineProject(fourForty, { powerMode: 'constant' }))).toEqual([]);
  });

  it('reaches Save, Start and Job Review through the job-intent advisories', () => {
    const project = lineProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const all = detectJobIntentWarnings(project, compileJob(project.scene, project.device));
    expect(all.filter((warning) => warning.includes('constant power (M3)'))).toHaveLength(1);
  });
});

// ADR-257 Amendment 2 (rolling audit v8 N8-P2-5): twenty bars 3 mm tall, the
// audit's stand-in for small text. 0.3 mm strokes 0.3 mm apart make every
// emitted move 0.3 mm, so 15 blocks at 500 mm/s² hold the rows to
// sqrt(2·500·14·0.3) = 64.8 mm/s, 3888 mm/min.
function bars(strokeMm: number, gapMm: number): SceneObject {
  const pitch = strokeMm + gapMm;
  const polylines = Array.from({ length: 20 }, (_, index) => {
    const x = 20 + index * pitch;
    const points = [
      { x, y: 20 },
      { x: x + strokeMm, y: 20 },
      { x: x + strokeMm, y: 23 },
      { x, y: 23 },
    ];
    return { points, closed: true };
  });
  return {
    kind: 'imported-svg',
    id: 'bars',
    source: 'bars.svg',
    bounds: { minX: 20, minY: 20, maxX: 20 + 19 * pitch + strokeMm, maxY: 23 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines }],
  };
}

function fillProject(
  device: DeviceProfile,
  patch: Partial<Layer> = {},
  object: SceneObject = bars(0.3, 0.3),
): Project {
  const layer = createLayer({ id: COLOR, name: 'Small text', color: COLOR, mode: 'fill' });
  return projectFor(device, { ...layer, speed: 6000, ...patch }, [object]);
}

function fillAdvice(project: Project): ReadonlyArray<string> {
  const job = compileJob(project.scene, project.device);
  return detectJobIntentWarnings(project, job).filter((warning) =>
    warning.includes('constant power (M3)'),
  );
}

describe('constant-power (M3) Fill advice (N8-P2-5)', () => {
  it('warns for a GRBL Compatible small-text fill whose rows outrun the look-ahead', () => {
    const result = fillAdvice(fillProject(GRBL_COMPATIBLE));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Fill operation "Small text" burns with constant power (M3)');
    expect(result[0]).toContain('as the GRBL Compatible dialect does for fills');
    expect(result[0]).toContain('Where they are narrowest they average 0.3 mm');
    expect(result[0]).toContain('holds those rows to about 3888 mm/min');
    expect(result[0]).toContain('small text and thin strokes can burn darker');
    expect(result[0]).toContain('If the controller runs GRBL 1.1f or newer, choose GRBL Dynamic');
    expect(result[0]).toContain('lower the speed to about 3888 mm/min');
  });

  // The audit's refuter found the runway advisory silent here: this advice is
  // the only notice left.
  it('warns under Automatic overscan too', () => {
    const project = fillProject(GRBL_COMPATIBLE, { autoOverscan: true });
    const [group] = compileJob(project.scene, project.device).groups;
    expect(group).toMatchObject({ kind: 'fill', overscanMm: 11 });
    const result = fillAdvice(project);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('holds those rows to about 3888 mm/min');
  });

  it('does not appear under GRBL Dynamic (M4), with either overscan', () => {
    expect(fillAdvice(fillProject(GRBL_DYNAMIC))).toEqual([]);
    expect(fillAdvice(fillProject(GRBL_DYNAMIC, { autoOverscan: true }))).toEqual([]);
    // The 4040 fills with M4 as well (it keeps M3 for Line cuts only).
    expect(fillAdvice(fillProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE))).toEqual([]);
  });

  it('stays quiet where the look-ahead keeps the programmed feed', () => {
    expect(fillAdvice(fillProject(GRBL_COMPATIBLE, { speed: 3800 }))).toEqual([]);
    // 1.2 mm strokes 0.3 mm apart: 0.75 mm moves hold 6148 mm/min.
    expect(fillAdvice(fillProject(GRBL_COMPATIBLE, {}, bars(1.2, 0.3)))).toEqual([]);
    // Short strokes far apart: 14 moves still cover 18.9 mm.
    expect(fillAdvice(fillProject(GRBL_COMPATIBLE, {}, bars(0.3, 2.4)))).toEqual([]);
  });

  it('says nothing to an operation set to a power mode by hand', () => {
    expect(fillAdvice(fillProject(GRBL_COMPATIBLE, { powerMode: 'constant' }))).toEqual([]);
    expect(fillAdvice(fillProject(GRBL_COMPATIBLE, { powerMode: 'dynamic' }))).toEqual([]);
  });

  it("uses grblHAL's deeper planner, which holds these short rows", () => {
    const grblHal = { ...GRBL_COMPATIBLE, controllerKind: 'grblhal' as const };
    expect(fillAdvice(fillProject(grblHal))).toEqual([]);
  });

  it('gives an offset fill the corner advice, without Lead-in / Lead-out', () => {
    const result = fillAdvice(lineProject(GRBL_COMPATIBLE, { mode: 'fill', fillStyle: 'offset' }));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Fill operation "Outline" burns with constant power (M3)');
    expect(result[0]).toContain('as the GRBL Compatible dialect does for fills');
    expect(result[0]).toContain('so corners, path starts and path ends burn darker');
    expect(result[0]).toContain('choose GRBL Dynamic in Machine Setup');
    expect(result[0]).not.toContain('Lead-in');
    const dynamic = lineProject(GRBL_DYNAMIC, { mode: 'fill', fillStyle: 'offset' });
    expect(fillAdvice(dynamic)).toEqual([]);
  });
});
