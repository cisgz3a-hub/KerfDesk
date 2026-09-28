// Stay-down pockets and the park height (ADR-491) against the scripted GRBL
// simulator: a compiled pocket streams through the real store into stock GRBL
// (15 planner blocks, 128-byte receive buffer), ends parked at the park
// height, holds a bit change there, and pauses and resumes on a step that
// stays in the cut.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { compileCncJob } from '../../core/cnc';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { cncGrblStrategy } from '../../core/output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Vec2,
} from '../../core/scene';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

const SAFE_Z = DEFAULT_CNC_MACHINE_CONFIG.params.safeZMm;
const PARK_Z = 40;
const POCKET = { cutType: 'pocket' as const, toolId: 'em-6350', depthMm: 6, depthPerPassMm: 2 };
// A stay-down step: a feed move at depth, at the plunge feed, that keeps its Z.
const STEP_LINE = /^G1 X(-?[\d.]+) Y(-?[\d.]+) Z(-[\d.]+) F300$/;

function rect(x: number, y: number, w: number, h: number): Vec2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function pocketObject(id: string, color: string, points: Vec2[]): ImportedSvg {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [{ closed: true, points }] }],
  };
}

function pocketLayer(color: string, cnc: Partial<CncLayerSettings>) {
  return { ...createLayer({ id: color, color }), cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc } };
}

function emit(cnc: Partial<CncLayerSettings>, secondBit = false): string {
  const objects = [pocketObject('A', '#ff0000', rect(20, 20, 60, 40))];
  const layers = [pocketLayer('#ff0000', { ...POCKET, ...cnc })];
  if (secondBit) {
    objects.push(pocketObject('B', '#0000ff', rect(100, 20, 40, 30)));
    layers.push(pocketLayer('#0000ff', { ...POCKET, toolId: 'em-3175', depthMm: 4 }));
  }
  const machine = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, parkXMm: 10, parkYMm: 10, parkZMm: PARK_Z },
  };
  const job = compileCncJob({ objects, layers }, DEFAULT_DEVICE_PROFILE, machine);
  return cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
}

function jobLines(gcode: string): string[] {
  return gcode
    .split('\n')
    .map((line) => line.replace(/;.*$/, '').trim())
    .filter((line) => line !== '');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    safetyNotice: null,
    controllerOperation: null,
    motionOperation: null,
    streamer: null,
    cncPauseLift: null,
    log: [],
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function settle<T>(action: Promise<T>, limitMs = 30_000): Promise<T> {
  let settled = false;
  const tracked = action.finally(() => {
    settled = true;
  });
  tracked.catch(() => undefined);
  for (let elapsed = 0; elapsed < limitMs && !settled; elapsed += 20) await pump(20);
  return tracked;
}

async function connectAndStart(gcode: string): Promise<GrblSimulator> {
  const sim = createGrblSimulator({
    motionMs: 2,
    plannerBlocks: 15,
    blockRetireMs: 2,
    settings: [[32, '0']],
  });
  await useLaserStore.getState().connect(sim.adapter);
  await pump(1200);
  const state = useLaserStore.getState();
  await settle(
    state.startJob(gcode, {
      machineKind: 'cnc',
      cncSetupAttestation: createCncSetupAttestation(gcode, cncControllerEpochOf(state)),
    }),
    5_000,
  );
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  return sim;
}

/** Pump until the stream ends or holds for a bit change. */
async function runUntilStopped(): Promise<string> {
  for (let elapsed = 0; elapsed < 120_000; elapsed += 50) {
    const status = useLaserStore.getState().streamer?.status ?? 'ended';
    if (status === 'ended' || status === 'tool-change') return status;
    await pump(50);
  }
  return useLaserStore.getState().streamer?.status ?? 'ended';
}

function controllerProblems(): string[] {
  const state = useLaserStore.getState();
  return [
    ...(state.safetyNotice === null ? [] : [state.safetyNotice.message]),
    ...(state.alarmCode === null ? [] : [`ALARM:${state.alarmCode}`]),
    ...(state.lastWriteError === null ? [] : [state.lastWriteError]),
    ...state.log.filter((line) => /error:|ALARM/i.test(line)),
  ];
}

function expectParked(sim: GrblSimulator): void {
  expect(sim.state().spindle).toBe(0);
  expect(sim.state().mpos).toEqual({ x: 10, y: 10, z: PARK_Z });
}

describe('stay-down pockets against the GRBL simulator', () => {
  it.each(['offset', 'raster-x'] as const)(
    'streams a %s pocket to the end and parks at the park height',
    async (pocketStrategy) => {
      const gcode = emit({ pocketStrategy });
      const lines = jobLines(gcode);
      expect(lines.filter((line) => STEP_LINE.test(line)).length).toBeGreaterThan(0);
      const sim = await connectAndStart(gcode);

      expect(await runUntilStopped()).toBe('ended');
      await pump(500);
      const sent = sim
        .outbound()
        .filter((write) => write !== '?')
        .join('')
        .split('\n')
        .filter((line) => line !== '');
      // Every job line reached the controller, in order.
      let delivered = 0;
      for (const line of sent) if (line === lines[delivered]) delivered += 1;
      expect(delivered).toBe(lines.length);
      expect(controllerProblems()).toEqual([]);
      expect(sim.state().machine).toBe('Idle');
      expectParked(sim);
    },
  );

  it('holds a bit change at the park height with the spindle off', async () => {
    const sim = await connectAndStart(emit({}, true));

    expect(await runUntilStopped()).toBe('tool-change');
    await pump(500);
    expect(controllerProblems()).toEqual([]);
    expectParked(sim);
  });

  it.each(['offset', 'raster-x'] as const)(
    'pauses and resumes a %s pocket on a step that stays in the cut',
    async (pocketStrategy) => {
      const gcode = emit({ pocketStrategy });
      const steps = jobLines(gcode)
        .map((line) => STEP_LINE.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({ x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }))
        .filter((step) => step.z < -2.5);
      const sim = await connectAndStart(gcode);
      // Pause once the controller's newest line is a step on the second level.
      let step: (typeof steps)[number] | undefined;
      for (let waited = 0; waited < 20_000 && step === undefined; waited += 1) {
        await pump(1);
        const at = sim.state().mpos;
        step = steps.find((s) => s.x === at.x && s.y === at.y && s.z === at.z);
      }
      if (step === undefined) throw new Error('the stream never reached a stay-down step');

      await settle(useLaserStore.getState().pauseJob());
      const lifted = useLaserStore.getState().cncPauseLift;
      expect(lifted?.phase).toBe('lifted');
      expect(lifted?.plan.entry).toEqual(step);
      expect(sim.state().mpos.z).toBeCloseTo(SAFE_Z, 3);
      expect(sim.state().spindle).toBe(0);

      const beforeResume = sim.outbound().length;
      await settle(useLaserStore.getState().resumeJob());
      const reentry = sim
        .outbound()
        .slice(beforeResume)
        .filter((write) => write !== '?');
      expect(reentry).toContain(`G0 X${step.x.toFixed(3)} Y${step.y.toFixed(3)}\n`);
      expect(reentry).toContain(`G1 Z${step.z.toFixed(3)} F300\n`);

      expect(await runUntilStopped()).toBe('ended');
      await pump(500);
      expect(controllerProblems()).toEqual([]);
      expectParked(sim);
    },
  );
});
