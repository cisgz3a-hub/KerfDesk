import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerKind } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { encodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
import { emitPreparedGcode, prepareOutput, prepareOutputSnapshot } from '../../io/gcode';
import { emitSaveGcode } from '../app/save-gcode-emission';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { consumeClaimedFramedRun } from '../state/framed-run-start-consumption';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { currentFirePowerS } from '../state/laser-fire-power';
import { buildPreviewToolpath } from '../workspace/draw-preview';
import { previewRouteForDrawing } from '../workspace/executable-plan-preview-route';
import { prepareLargeJob } from '../workspace/large-job-preparation';
import { frameOnceRepository, installFrameOnceProject } from './frame-once.test-support';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runStartJobFlow } from './start-job-flow';
import { machineSnapshot } from './start-machine-snapshot';
import { prepareCurrentStartJob } from './start-job-source';
import { prepareOutputRequest } from './output-preparation';
import {
  laserPowerPreparationOptions,
  laserPowerScaleWarnings,
  frozenLaserPowerScaleWarnings,
  resolveLaserPowerScale,
} from './connected-laser-power-scale';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStart = useLaserStore.getState().startJob;
let uninstall: () => void = () => undefined;

beforeEach(() => {
  installFrameOnceProject();
  ensureFramedRunInvalidationSubscriptions();
  useJobReviewStore.getState().close();
  observeMax(1000);
  useLaserStore.setState({
    startJob: vi.fn(async (_gcode, options = {}) => {
      options.assertFinalStartAuthorized?.();
      consumeClaimedFramedRun(
        useLaserStore.setState,
        useLaserStore.getState,
        options.framedRunPermit,
      );
    }),
  });
  uninstall = installAutoJobReview('confirm');
});

afterEach(() => {
  uninstall();
  useJobReviewStore.getState().close();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStart });
  vi.restoreAllMocks();
});

function observeMax(maxPowerS: number, kind: ControllerKind = 'grbl-v1.1'): void {
  useLaserStore.setState((state) => ({
    activeControllerKind: kind,
    controllerSettings: { ...state.controllerSettings, maxPowerS },
    controllerSettingsObservation: { sessionEpoch: state.controllerSessionEpoch, observedAt: 1 },
  }));
}

function source() {
  return {
    ...useLaserStore.getState(),
    connected: useLaserStore.getState().connection.kind === 'connected',
  };
}

function powerWords(gcode: string): number[] {
  return gcode
    .split('\n')
    .flatMap((line) => [...line.split(';')[0]!.matchAll(/S(\d+(?:\.\d+)?|\.\d+)/g)])
    .map((match) => Number(match[1]))
    .filter((power) => power > 0);
}

function currentStartOutput() {
  return prepareCurrentStartJob(
    useStore.getState(),
    useLaserStore.getState(),
    useCameraStore.getState(),
    undefined,
    false,
  );
}

function imageProject(power: number, pixels = [0, 128, 255]): Project {
  const base = useStore.getState().project;
  return {
    ...base,
    device: { ...base.device, maxPowerS: 255 },
    scene: {
      ...base.scene,
      layers: base.scene.layers.map((layer) => ({
        ...layer,
        mode: 'image',
        power,
        linesPerMm: 1,
        ditherAlgorithm: 'grayscale',
        fillOverscanMm: 0,
      })),
      objects: [
        {
          kind: 'raster-image',
          id: 'image',
          source: 'audit.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          pixelWidth: pixels.length,
          pixelHeight: 1,
          bounds: { minX: 10, minY: 10, maxX: 10 + pixels.length, maxY: 11 },
          transform: IDENTITY_TRANSFORM,
          color: base.scene.layers[0]!.color,
          dither: 'grayscale',
          linesPerMm: 1,
          lumaBase64: encodeCanonicalBase64(Uint8Array.from(pixels)),
        },
      ],
    },
  };
}

describe('current connection determines laser execution S range', () => {
  it.each([
    { profile: 255, observed: 1000, percent: 100, expected: 1000 },
    { profile: 1000, observed: 255, percent: 25, expected: 64 },
    { profile: 255, observed: 1000, percent: 0.1, expected: 1 },
  ])(
    'reviews, starts and archives $percent% using S$expected, leaving profile S$profile saved',
    async (row) => {
      useStore.getState().updateDeviceProfile({ maxPowerS: row.profile });
      useStore.getState().setLayerParam('red', { power: row.percent, powerMode: 'constant' });
      observeMax(row.observed);
      await installReviewPendingFramedRunPermitForCurrentState();
      const repository = frameOnceRepository();
      await runStartJobFlow(repository);
      const calls = vi.mocked(useLaserStore.getState().startJob).mock.calls;
      expect(calls).toHaveLength(1);
      expect(powerWords(calls[0]![0])).toContain(row.expected);
      expect(calls[0]![0]).toContain('M3 S0');
      const artifact = repository.getSnapshot().activeRun?.artifact;
      expect(artifact?.gcode).toBe(calls[0]![0]);
      expect(artifact?.prepared.project.device.maxPowerS).toBe(row.observed);
      expect(useStore.getState().project.device.maxPowerS).toBe(row.profile);
    },
  );

  it.each(['grbl-v1.1', 'grblhal', 'fluidnc'] as const)(
    'uses current %s range for fractional percentages and M4 too',
    async (kind) => {
      observeMax(255, kind);
      useStore.getState().updateDeviceProfile({ controllerKind: kind, maxPowerS: 1000 });
      useStore.getState().setLayerParam('red', { power: 12.5, powerMode: 'dynamic' });
      const prepared = await currentStartOutput();
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error('Expected laser output');
      expect(powerWords(prepared.gcode)).toContain(32);
      expect(prepared.gcode).toContain('M4 S0');
    },
  );

  it('keeps object scaling and per-operation power overrides in the current range', async () => {
    useStore.getState().updateDeviceProfile({ maxPowerS: 255 });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) => ({
            ...object,
            powerScale: 50,
            operationOverride: { byOperation: { red: { power: 64 } } },
          })),
        },
      },
    }));
    const prepared = await currentStartOutput();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('Expected laser output');
    expect(powerWords(prepared.gcode)).toContain(320);
  });

  it('discards missing, stale, disconnected and invalid power observations', () => {
    const project = useStore.getState().project;
    const current = source();
    for (const override of [
      { connected: false },
      { controllerSettingsObservation: null },
      { controllerSessionEpoch: 8 },
      { controllerSettings: { maxPowerS: Number.NaN } },
      { controllerSettings: { maxPowerS: 0 } },
      { activeControllerKind: 'marlin' as const },
    ]) {
      expect(
        resolveLaserPowerScale({ ...project.device, maxPowerS: 255 }, { ...current, ...override }),
      ).toEqual({ source: 'profile', maxPowerS: 255 });
    }
    expect(laserPowerScaleWarnings(project, { ...current, connected: false })[0]).toMatch(
      /profile assumption/,
    );
    const cnc = { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG };
    expect(laserPowerPreparationOptions(cnc, current)).toEqual({});
    const spindle = prepareOutput(cnc);
    expect(spindle.ok).toBe(true);
    expect(prepareOutput(cnc, { laserMaxPowerS: 70000 })).toEqual(spindle);
    const marlin = {
      ...project,
      device: { ...project.device, controllerKind: 'marlin' as const, maxPowerS: 255 },
    };
    const marlinOptions = laserPowerPreparationOptions(marlin, current);
    expect(marlinOptions).toEqual({ laserMaxPowerS: 255 });
    expect(prepareOutput(marlin, marlinOptions)).toEqual(prepareOutput(marlin));
  });

  it('reuses spatial Frame after a power-range change, but reviews and archives the new exact output', async () => {
    useStore.getState().setLayerParam('red', { power: 100 });
    const framed = await installReviewPendingFramedRunPermitForCurrentState();
    observeMax(255);
    expect(useLaserStore.getState().completedFrame).toBe(framed);
    await runStartJobFlow(frameOnceRepository());
    expect(powerWords(vi.mocked(useLaserStore.getState().startJob).mock.calls[0]![0])).toContain(
      255,
    );
  });

  it('requires a fresh approval when the current $30 changes inside Job Review', async () => {
    useStore.getState().setLayerParam('red', { power: 100 });
    await installReviewPendingFramedRunPermitForCurrentState();
    uninstall();
    let clicks = 0;
    uninstall = installAutoJobReview(() => {
      if (++clicks === 1) observeMax(255);
      return 'confirm';
    });
    await runStartJobFlow(frameOnceRepository());
    expect(clicks).toBe(2);
    expect(powerWords(vi.mocked(useLaserStore.getState().startJob).mock.calls[0]![0])).toContain(
      255,
    );
  });

  it('refuses stale reviewed output after $30 changes during durable handoff and retains the Frame', async () => {
    useStore.getState().setLayerParam('red', { power: 100 });
    await installReviewPendingFramedRunPermitForCurrentState();
    const repository = frameOnceRepository();
    const arm = repository.armFreshStartIntent.bind(repository);
    vi.spyOn(repository, 'armFreshStartIntent').mockImplementationOnce(async (...args) => {
      observeMax(255);
      return arm(...args);
    });
    await runStartJobFlow(repository);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(useLaserStore.getState().completedFrame).not.toBeNull();
    expect(repository.getSnapshot().pendingStart).toBeNull();
    await runStartJobFlow(repository);
    expect(powerWords(vi.mocked(useLaserStore.getState().startJob).mock.calls[0]![0])).toContain(
      255,
    );
  });

  it('accepts equal-value settings refreshes without another Frame or changed output', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    const repository = frameOnceRepository();
    const arm = repository.armFreshStartIntent.bind(repository);
    vi.spyOn(repository, 'armFreshStartIntent').mockImplementationOnce(async (...args) => {
      observeMax(1000);
      return arm(...args);
    });
    await runStartJobFlow(repository);
    expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
  });

  it('checks the power binding again at the final synchronous transport assertion', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    useLaserStore.setState({
      startJob: vi.fn(async (_gcode, options = {}) => {
        observeMax(255);
        options.assertFinalStartAuthorized?.();
      }),
    });
    const repository = frameOnceRepository();
    await runStartJobFlow(repository);
    expect(useLaserStore.getState().completedFrame).not.toBeNull();
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(useLaserStore.getState().framedRunStartClaim).toBeNull();
  });

  it('explicitly discloses a frozen saved-job scale without changing those bytes', () => {
    const project = {
      ...useStore.getState().project,
      device: { ...useStore.getState().project.device, maxPowerS: 255 },
    };
    const frozen = emitPreparedGcode(prepareOutput(project)).gcode;
    expect(frozenLaserPowerScaleWarnings(project, source())[0]).toMatch(
      /exact saved bytes are unchanged/,
    );
    expect(powerWords(frozen)).toContain(Math.round((project.scene.layers[0]!.power * 255) / 100));
    expect(emitPreparedGcode(prepareOutput(project)).gcode).toBe(frozen);
  });

  it.each([1e-7, 0.001, 0.5, 255.5, 1000.25, 70000, 1000000, 1e21])(
    'spells the M3 S endpoint in decimal at observed max %s',
    async (range) => {
      observeMax(range);
      useStore.getState().setLayerParam('red', { power: 100, powerMode: 'constant' });
      const prepared = await currentStartOutput();
      if (!prepared.ok) throw new Error('Expected prepared vector output');
      expect(powerWords(prepared.gcode)).toContain(range);
      expect(prepared.gcode).toContain('M3 S0');
    },
  );

  it('spells a tiny fractional share without consuming stock GRBL precision on a leading zero', async () => {
    observeMax(1e-7);
    useStore.getState().setLayerParam('red', { power: 50 });
    const prepared = await currentStartOutput();
    if (!prepared.ok) throw new Error('Expected prepared output');
    expect(powerWords(prepared.gcode)).toContain(5e-8);
    expect(prepared.gcode).toContain('S.00000005');
    expect(prepared.gcode).not.toMatch(/S\d+(?:\.\d+)?[eE][+-]?\d/);
  });

  it('leaves the one-second start mark on its smaller profile/controller cap', () => {
    const control = { enabled: true, maxPowerPercent: 1, maxPowerS: 10 };
    expect(currentFirePowerS(useLaserStore.getState(), control, 255)).toBe(2);
    observeMax(255);
    expect(currentFirePowerS(useLaserStore.getState(), control, 1000)).toBe(2);
  });
});

describe('prepared output preserves power parity before raster quantization', () => {
  it('does not lose a 0.1% black pixel by first quantizing against the old S255 profile', () => {
    const project = imageProject(0.1, [0]);
    const original = prepareOutput(project);
    const effective = prepareOutput(project, laserPowerPreparationOptions(project, source()));
    if (!original.ok || !effective.ok) throw new Error('Expected raster');
    const originalRaster = original.job.groups.find((group) => group.kind === 'raster');
    const effectiveRaster = effective.job.groups.find((group) => group.kind === 'raster');
    expect(originalRaster?.kind === 'raster' && [...originalRaster.sValues]).toEqual([0]);
    expect(effectiveRaster?.kind === 'raster' && [...effectiveRaster.sValues]).toEqual([1]);
    expect(powerWords(emitPreparedGcode(effective).gcode)).toContain(1);
    expect(project.device.maxPowerS).toBe(255);
  });

  it('binds snapshot caches to the effective range before compiling pixels', async () => {
    const project = imageProject(100, [0]);
    const renderVariableText = vi.fn();
    const options = { clock: () => new Date(0), renderVariableText };
    const lower = await prepareOutputSnapshot(project, { ...options, laserMaxPowerS: 255 });
    const higher = await prepareOutputSnapshot(project, { ...options, laserMaxPowerS: 1000 });
    expect(powerWords(emitPreparedGcode(lower).gcode)).toContain(255);
    expect(powerWords(emitPreparedGcode(higher).gcode)).toContain(1000);
  });

  it('uses one range for connected Save, Start, Preview/ETA worker preparation and the archive', async () => {
    const project = imageProject(100, [0]);
    useStore.setState({ project });
    const machine = machineSnapshot(project, useLaserStore.getState(), useCameraStore.getState());
    const prepared = await currentStartOutput();
    if (!prepared.ok) throw new Error('Expected prepared start');
    const saved = await emitSaveGcode(
      {
        project,
        machine,
        controllerSettings: machine.controllerSettings,
        platform: {} as never,
        savedName: null,
        pushToast: vi.fn(),
      },
      { ok: true },
    );
    expect(saved.kind).toBe('emitted');
    expect(powerWords(saved.gcode)).toEqual(powerWords(prepared.gcode));
    const response = await prepareOutputRequest({
      kind: 'save',
      project,
      options: {},
      laserPowerScaleSource: machine,
      controllerSettings: machine.controllerSettings,
    });
    expect(response.kind).toBe('save');
    if (response.kind !== 'save') throw new Error('Expected Save response');
    expect(response.result.gcode).toBe(prepared.gcode);
    const ranges: number[] = [];
    prepareLargeJob(project, { laserMaxPowerS: 1000 }, (originalProject, options) => {
      const compiled = prepareOutput(originalProject, options);
      if (compiled.ok) ranges.push(compiled.project.device.maxPowerS);
      return compiled;
    });
    expect(ranges).toEqual([1000]);
    const preview = buildPreviewToolpath(project, { laserMaxPowerS: 1000 });
    expect(previewRouteForDrawing(preview).steps.length).toBeGreaterThan(0);
    expect(project.device.maxPowerS).toBe(255);
  });

  it.each([1e-7, 0.001, 0.5, 255.5, 1000.25, 70000, 1000000, 1e21])(
    'retains full power and raster tones at S max %s',
    (range) => {
      const project = imageProject(100, [0, 128]);
      const prepared = prepareOutput(project, { laserMaxPowerS: range });
      const words = powerWords(emitPreparedGcode(prepared).gcode);
      expect(words).toContain(range);
      expect(words.some((power) => power > 0 && power < range)).toBe(true);
      expect(words.every((power) => power <= range)).toBe(true);
    },
  );
});
