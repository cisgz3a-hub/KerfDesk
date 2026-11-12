// The Moshi USB, Ruida network and K40 USB jobs compile as Save and G-code Start do
// (ADR-705 Amendment 4, code quality audit C2 D2-P1-1 and D2-P2-1): with the
// canvas output scope, and carrying the shared job warnings G-code shows.
import { describe, expect, it } from 'vitest';
import { LHY_STEPS_PER_MM } from '../../core/controllers/lihuiyu/lhy-motion-plan';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../../core/devices';
import { K40_M2_NANO_PROFILE } from '../../core/devices/lihuiyu-profiles';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type OutputScope,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { detectMachineJobWarnings } from '../laser/machine-job-warnings';
import { linkJobRequest } from './link-job-request';
import { prepareLihuiyuUsbJob } from './lihuiyu-usb/lihuiyu-usb-job';
import { prepareMoshiUsbJob } from './moshi-usb/moshi-usb-job';
import { prepareRuidaNetworkJob } from './ruida-network/ruida-network-job';

const ABSOLUTE = {
  startFrom: 'absolute',
  anchor: 'center',
} as unknown as Parameters<typeof linkJobRequest>[1];

function square(minX: number, minY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + size, y: minY },
      { x: minX + size, y: minY + size },
      { x: minX, y: minY + size },
    ],
  };
}

function shape(id: string, polyline: Polyline, operationIds: ReadonlyArray<string>): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    operationIds,
    paths: [{ color: '#ff0000', polylines: [polyline] }],
  };
}

function layer(id: string, settings: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, color: '#ff0000', name: id }), ...settings };
}

function project(
  kind: ControllerKind,
  layers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
): Project {
  return {
    ...createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind: kind }),
    scene: { layers: [...layers], objects: [...objects] },
  };
}

// A at X 20-40 is selected; B at X 100-120 is not.
const twoSquares = (kind: ControllerKind) =>
  project(
    kind,
    [layer('L1')],
    [shape('A', square(20, 20, 20), ['L1']), shape('B', square(100, 20, 20), ['L1'])],
  );
const SELECTED_A: OutputScope = {
  cutSelectedGraphics: true,
  useSelectionOrigin: false,
  selectedObjectIds: ['A'],
};

// A part on a kerf layer inside a sheet outline with no kerf: the compile
// assumes which side the kerf goes (ADR-486 Amd 3) and G-code warns.
const kerfSideCase = (kind: ControllerKind) =>
  project(
    kind,
    [layer('Sheet'), layer('Parts', { kerfOffsetMm: 0.4 })],
    [shape('sheet', square(10, 10, 100), ['Sheet']), shape('part', square(40, 40, 40), ['Parts'])],
  );

function gcodeJobWarnings(p: Project): ReadonlyArray<string> {
  const prepared = prepareOutput(p, {});
  if (!prepared.ok) throw new Error('expected the project to prepare');
  return detectMachineJobWarnings(prepared.project, null, null, prepared);
}

describe('Moshi USB job', () => {
  it('burns only the selected artwork when Selected artwork only is on', async () => {
    const whole = await prepareMoshiUsbJob(linkJobRequest(twoSquares('moshi'), ABSOLUTE));
    const scoped = await prepareMoshiUsbJob(
      linkJobRequest(twoSquares('moshi'), ABSOLUTE, SELECTED_A),
    );
    if (!whole.ok || !scoped.ok) throw new Error('expected both jobs to compile');
    const mm = (mils: number) => mils * 0.0254;
    expect(mm(whole.job.footprint.maxX)).toBeGreaterThan(115);
    expect(mm(scoped.job.footprint.minX)).toBeCloseTo(20, 0);
    expect(mm(scoped.job.footprint.maxX)).toBeCloseTo(40, 0);
  });

  it('carries the job warnings G-code shows', async () => {
    const p = kerfSideCase('moshi');
    const expected = gcodeJobWarnings(p);
    expect(expected.some((warning) => warning.includes('Kerf offset'))).toBe(true);
    const result = await prepareMoshiUsbJob(linkJobRequest(p, ABSOLUTE));
    if (!result.ok) throw new Error(result.messages.join(' '));
    for (const warning of expected) expect(result.job.advisories).toContain(warning);
  });
});

describe('Ruida network job', () => {
  it('burns only the selected artwork when Selected artwork only is on', async () => {
    const whole = await prepareRuidaNetworkJob(linkJobRequest(twoSquares('ruida'), ABSOLUTE));
    const scoped = await prepareRuidaNetworkJob(
      linkJobRequest(twoSquares('ruida'), ABSOLUTE, SELECTED_A),
    );
    if (!whole.ok || !scoped.ok) throw new Error('expected both jobs to compile');
    const widthUm = (job: typeof whole.job) =>
      job.footprint.bounds.maxX - job.footprint.bounds.minX;
    expect(widthUm(whole.job)).toBeCloseTo(100_000, -3);
    expect(widthUm(scoped.job)).toBeCloseTo(20_000, -3);
  });

  it('carries the job warnings G-code shows', async () => {
    const p = kerfSideCase('ruida');
    const expected = gcodeJobWarnings(p);
    const result = await prepareRuidaNetworkJob(linkJobRequest(p, ABSOLUTE));
    if (!result.ok) throw new Error(result.messages.join(' '));
    for (const warning of expected) expect(result.job.advisories).toContain(warning);
  });
});

// The K40 joins the shared request (ADR-703 Amendment 1, code quality audit C2
// D6-P1-1 and D6-P2-1): a Lihuiyu profile homes rear-left, and an Absolute job
// runs from the homed head.
const asK40 = (p: Project): Project => ({
  ...createProject(K40_M2_NANO_PROFILE),
  scene: p.scene,
});
const HOMED = { x: 0, y: 0 };

describe('K40 USB job', () => {
  it('burns only the selected artwork when Selected artwork only is on', async () => {
    const p = asK40(twoSquares('lihuiyu'));
    const whole = await prepareLihuiyuUsbJob(linkJobRequest(p, ABSOLUTE), HOMED);
    const scoped = await prepareLihuiyuUsbJob(linkJobRequest(p, ABSOLUTE, SELECTED_A), HOMED);
    if (!whole.ok || !scoped.ok) throw new Error('expected both jobs to compile');
    const widthMm = (job: typeof whole.job) =>
      (job.footprint.bounds.maxX - job.footprint.bounds.minX) / LHY_STEPS_PER_MM;
    expect(widthMm(whole.job)).toBeCloseTo(100, 0);
    expect(widthMm(scoped.job)).toBeCloseTo(20, 0);
  });

  it('carries the job warnings G-code shows and the variable advance', async () => {
    const p = asK40(kerfSideCase('lihuiyu'));
    const expected = gcodeJobWarnings(p);
    expect(expected.length).toBeGreaterThan(0);
    const request = linkJobRequest(p, ABSOLUTE);
    const result = await prepareLihuiyuUsbJob(request, HOMED);
    if (!result.ok) throw new Error(result.messages.join(' '));
    for (const warning of expected) expect(result.job.advisories).toContain(warning);
    expect(result.job.completed).toBe(request.completed);
  });
});
