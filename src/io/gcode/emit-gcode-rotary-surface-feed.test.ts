import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  GRBL_MACHINE_PROFILE_CATALOG,
  rotaryYScale,
  type DeviceProfile,
  type RotarySetup,
} from '../../core/devices';
import { machineSpaceJob } from '../../core/job';
import { selectOutputStrategy } from '../../core/output';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { Vec2 } from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';

// ADR-127 Amendment 2 (rolling audit v12 X8-P1-1). The controller times a G1
// by its commanded XY vector: a move of (dx, dy) machine mm at F takes
// hypot(dx, dy) / F minutes. On a Y-port rotary the part's surface travels
// (dx, dy / k) in that time, k being machine Y mm per surface mm. These tests
// read the emitted G-code back with that rule alone, independent of the
// emitter's own feed conversion, and check the surface moves at the layer
// speed in every direction.

const CREALITY_CHUCK_80: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
};
const ROLLER_25_80: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 40,
  objectDiameterMm: 80,
  rollerDiameterMm: 25,
};

const LINE_SPEED = 1500;
const FILL_SPEED = 3000;

function svg(id: string, color: string, polylines: ReadonlyArray<ReadonlyArray<Vec2>>) {
  const all = polylines.flat();
  const object: SceneObject = {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...all.map((p) => p.x)),
      minY: Math.min(...all.map((p) => p.y)),
      maxX: Math.max(...all.map((p) => p.x)),
      maxY: Math.max(...all.map((p) => p.y)),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [
      { color, polylines: polylines.map((points) => ({ points: [...points], closed: true })) },
    ],
  };
  return object;
}

function square(x: number, y: number, size: number): Vec2[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
  ];
}

function circle(cx: number, cy: number, r: number): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= 72; i += 1) {
    const a = (i / 72) * 2 * Math.PI;
    points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return points;
}

function diamond(cx: number, cy: number, r: number): Vec2[] {
  return [
    { x: cx + r, y: cy },
    { x: cx, y: cy + r },
    { x: cx - r, y: cy },
    { x: cx, y: cy - r },
    { x: cx + r, y: cy },
  ];
}

function layer(id: string, color: string, patch: Partial<Layer>): Layer {
  return { ...createLayer({ id, color }), ...patch };
}

/** A Line layer (square, circle, diamond), a 90° Fill and a 45° Fill. */
function vectorProject(device: DeviceProfile): Project {
  const base = createProject(device);
  let scene = base.scene;
  scene = addObject(
    scene,
    svg('LINE', '#ff0000', [square(20, 20, 20), circle(70, 30, 10), diamond(110, 30, 10)]),
  );
  scene = addObject(scene, svg('F90', '#00ff00', [square(20, 60, 20)]));
  scene = addObject(scene, svg('F45', '#0000ff', [square(60, 60, 20)]));
  scene = addLayer(scene, layer('L1', '#ff0000', { speed: LINE_SPEED }));
  scene = addLayer(
    scene,
    layer('L2', '#00ff00', { mode: 'fill', speed: FILL_SPEED, hatchAngleDeg: 90 }),
  );
  scene = addLayer(
    scene,
    layer('L3', '#0000ff', { mode: 'fill', speed: FILL_SPEED, hatchAngleDeg: 45 }),
  );
  return { ...base, scene };
}

type Burn = {
  readonly layer: string;
  readonly dx: number;
  readonly dy: number;
  readonly feed: number;
};

type Modal = { x: number; y: number; feed: number; power: number; motion: string };

/** Applies one line's words to the modal state; true when it names X or Y. */
function applyWords(code: string, state: Modal): boolean {
  let moved = false;
  for (const word of code.match(/[A-Z]-?\d*\.?\d+/g) ?? []) {
    const letter = word[0] ?? '';
    const value = Number(word.slice(1));
    if (letter === 'G' && (value === 0 || value === 1)) state.motion = `G${value}`;
    const key = MODAL_WORDS[letter];
    if (key !== undefined) state[key] = value;
    if (letter === 'X' || letter === 'Y') moved = true;
  }
  return moved;
}

const MODAL_WORDS: Readonly<Record<string, 'x' | 'y' | 'feed' | 'power'>> = {
  X: 'x',
  Y: 'y',
  F: 'feed',
  S: 'power',
};

/** A modal reader of the emitted program: every lit G1 with its feed. */
function litMoves(gcode: string): Burn[] {
  const burns: Burn[] = [];
  const state: Modal = { x: 0, y: 0, feed: Number.NaN, power: 0, motion: 'G0' };
  let currentLayer = '';
  for (const raw of gcode.split('\n')) {
    const layerComment = /^; (?:offset )?(?:fill )?layer (\S+)/.exec(raw);
    if (layerComment !== null) currentLayer = layerComment[1] ?? '';
    const code = raw.replace(/;.*$/, '').trim();
    const { x, y } = state;
    if (!applyWords(code, state)) continue;
    const dx = state.x - x;
    const dy = state.y - y;
    const lit = state.motion === 'G1' && state.power > 0;
    if (lit && (dx !== 0 || dy !== 0))
      burns.push({ layer: currentLayer, dx, dy, feed: state.feed });
  }
  return burns;
}

/** Surface mm per minute the program gives one lit move. */
function surfaceSpeed(burn: Burn, k: number): number {
  const machineMm = Math.hypot(burn.dx, burn.dy);
  const surfaceMm = Math.hypot(burn.dx, burn.dy / k);
  return (burn.feed * surfaceMm) / machineMm;
}

function profileFor(kind: DeviceProfile['controllerKind']): DeviceProfile {
  const found = GRBL_MACHINE_PROFILE_CATALOG.find((entry) => entry.profile.controllerKind === kind);
  if (found === undefined) throw new Error(`No catalog profile for ${kind}`);
  return found.profile;
}

const FALCON_A1_PRO = GRBL_MACHINE_PROFILE_CATALOG.find(
  (entry) => entry.profile.profileId === 'creality-falcon-a1-pro-grblhal',
)?.profile;

const PROFILES: ReadonlyArray<readonly [string, DeviceProfile]> = [
  ['GRBL 1.1', DEFAULT_DEVICE_PROFILE],
  ['grblHAL', profileFor('grblhal')],
  ['FluidNC', profileFor('fluidnc')],
  ['Marlin', profileFor('marlin')],
  ['Smoothieware', profileFor('smoothieware')],
  ...(FALCON_A1_PRO === undefined ? [] : [['Falcon A1 Pro', FALCON_A1_PRO] as const]),
];

const SETUPS: ReadonlyArray<readonly [string, RotarySetup]> = [
  ['Creality chuck, Ø80', CREALITY_CHUCK_80],
  ['roller Ø25, Ø80 part', ROLLER_25_80],
  ['Creality chuck reversed', { ...CREALITY_CHUCK_80, reverseAxis: true }],
];

const LAYER_SPEED: Readonly<Record<string, number>> = {
  L1: LINE_SPEED,
  L2: FILL_SPEED,
  L3: FILL_SPEED,
};

describe('rotary strokes move the surface at the layer speed (ADR-127 Amd 2)', () => {
  it.each(
    PROFILES.flatMap(([name, profile]) =>
      SETUPS.map(([setup, rotary]) => [name, setup, profile, rotary] as const),
    ),
  )('%s, %s', (_name, _setup, profile, rotary) => {
    const device = { ...profile, maxFeed: Math.max(profile.maxFeed, 20000), rotary };
    const result = emitGcode(vectorProject(device));
    expect(result.preflight.ok).toBe(true);
    const k = rotaryYScale(rotary);
    const burns = litMoves(result.gcode);
    // Every layer burned, with strokes round the part in each.
    for (const id of ['L1', 'L2', 'L3']) {
      expect(burns.filter((b) => b.layer === id && Math.abs(b.dy) > 0.01).length).toBeGreaterThan(
        0,
      );
    }
    const totals = new Map<string, { surfaceMm: number; minutes: number }>();
    for (const burn of burns) {
      const target = LAYER_SPEED[burn.layer];
      if (target === undefined) throw new Error(`Unlabelled burn in ${burn.layer}`);
      const machineMm = Math.hypot(burn.dx, burn.dy);
      const total = totals.get(burn.layer) ?? { surfaceMm: 0, minutes: 0 };
      total.surfaceMm += Math.hypot(burn.dx, burn.dy / k);
      total.minutes += machineMm / burn.feed;
      totals.set(burn.layer, total);
      // A fill's corner spans can be a few hundredths of a millimetre, where
      // the 3-decimal coordinates themselves bend the direction; every move
      // long enough to have one is checked on its own.
      if (machineMm < 0.25) continue;
      const speed = surfaceSpeed(burn, k);
      // Whole-number F words and 3-decimal coordinates: within 1 %. Before
      // ADR-127 Amd 2 a stroke round the chuck ran 6.3x the layer speed.
      expect(speed / target).toBeGreaterThan(0.99);
      expect(speed / target).toBeLessThan(1.01);
    }
    for (const [id, total] of totals) {
      expect(total.surfaceMm / total.minutes / (LAYER_SPEED[id] ?? 0)).toBeCloseTo(1, 2);
    }
  });

  it('slows a stroke round the Creality chuck to k × the layer speed and keeps X strokes at it', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, rotary: CREALITY_CHUCK_80 };
    const burns = litMoves(emitGcode(vectorProject(device)).gcode).filter((b) => b.layer === 'L1');
    const k = rotaryYScale(CREALITY_CHUCK_80);
    expect(k).toBeCloseTo(40 / (Math.PI * 80), 12);
    const alongX = burns.filter((b) => b.dy === 0);
    const roundPart = burns.filter((b) => b.dx === 0);
    expect(alongX.map((b) => b.feed)).toContain(LINE_SPEED);
    expect(new Set(alongX.map((b) => b.feed))).toEqual(new Set([LINE_SPEED]));
    expect(new Set(roundPart.map((b) => b.feed))).toEqual(new Set([Math.floor(LINE_SPEED * k)]));
  });

  it('caps a k > 1 roller at the machine maximum feed', () => {
    const roller: RotarySetup = { ...ROLLER_25_80, mmPerRotation: 360 };
    const k = rotaryYScale(roller);
    expect(k).toBeGreaterThan(4);
    const device = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000, rotary: roller };
    const burns = litMoves(emitGcode(vectorProject(device)).gcode);
    expect(Math.max(...burns.map((b) => b.feed))).toBe(6000);
    const roundPart = burns.filter((b) => b.layer === 'L1' && b.dx === 0);
    expect(roundPart.every((b) => b.feed === 6000)).toBe(true);
  });

  it('says once, in the program, why F changes inside a rotary layer', () => {
    const rotary = emitGcode(
      vectorProject({ ...DEFAULT_DEVICE_PROFILE, rotary: CREALITY_CHUCK_80 }),
    );
    const flat = emitGcode(vectorProject(DEFAULT_DEVICE_PROFILE));
    expect(rotary.gcode.match(/^; rotary: each move's F is scaled/gm)).toHaveLength(1);
    expect(flat.gcode).not.toContain('; rotary:');
  });
});

function rasterProject(device: DeviceProfile, withVector = false): Project {
  const color = '#808080';
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    color,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 4,
    lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
  const base = createProject(device);
  let scene = addLayer(
    addObject(base.scene, raster),
    createLayer({ id: 'L1', color, mode: 'image' }),
  );
  if (withVector) {
    scene = addObject(scene, svg('LINE', '#ff0000', [square(40, 10, 10)]));
    scene = addLayer(scene, layer('L2', '#ff0000', { speed: LINE_SPEED }));
  }
  return { ...base, scene };
}

function machineJobOf(project: Project) {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected a prepared job.');
  return machineSpaceJob(prepared.job, project.device, project.machine);
}

/** The program's lines by section: the image layer's own, and the rest. */
function imageSectionLines(gcode: string): string[] {
  const lines: string[] = [];
  let inImage = false;
  for (const line of gcode.split('\n')) {
    if (/^; image layer /.test(line)) inImage = true;
    else if (/^; (?:offset )?(?:fill )?layer /.test(line)) inImage = false;
    if (inImage) lines.push(line);
  }
  return lines;
}

describe('rotary images keep their bytes (ADR-127 Amd 2)', () => {
  it.each(SETUPS)(
    '%s: an image-only job emits exactly as without the feed match',
    (_name, rotary) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, rotary };
      const machineJob = machineJobOf(rasterProject(device));
      expect(machineJob.groups.map((group) => group.kind)).toEqual(['raster']);
      expect(machineJob.rotarySurfaceYScale).toBe(rotaryYScale(rotary));
      const { rotarySurfaceYScale: _dropped, ...unmatched } = machineJob;
      const strategy = selectOutputStrategy(device);
      expect(strategy.emit(machineJob, device)).toBe(strategy.emit(unmatched, device));
    },
  );

  it.each(SETUPS)(
    '%s: a mixed job changes only F words, none in its image rows',
    (_name, rotary) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, rotary };
      const machineJob = machineJobOf(rasterProject(device, true));
      expect(machineJob.groups.map((group) => group.kind).sort()).toEqual(['cut', 'raster']);
      const { rotarySurfaceYScale: _dropped, ...unmatched } = machineJob;
      const strategy = selectOutputStrategy(device);
      const matched = strategy.emit(machineJob, device).split('\n');
      const before = strategy.emit(unmatched, device).split('\n');
      const withoutDisclosure = matched.filter((line) => !line.startsWith('; rotary:'));
      expect(withoutDisclosure).toHaveLength(before.length);
      expect(withoutDisclosure.filter((line, i) => line !== before[i]).length).toBeGreaterThan(0);
      const noFeed = (line: string | undefined) => (line ?? '').replace(/ F\d+(?:\.\d+)?/, '');
      withoutDisclosure.forEach((line, i) => expect(noFeed(line)).toBe(noFeed(before[i])));
      const image = imageSectionLines(withoutDisclosure.join('\n'));
      expect(image.length).toBeGreaterThan(5);
      expect(image).toEqual(imageSectionLines(before.join('\n')));
    },
  );
});
