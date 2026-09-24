import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mixedCanvasCompilationProject } from '../../__fixtures__/mixed-canvas-compilation-project';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { useCameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';
import { resetOutputPreparationWorkerForTests } from './output-preparation-worker-client';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { prepareCurrentStartJob } from './start-job-source';
import { STALE_START_PREPARATION_MESSAGE } from './start-preparation-owner';

const ZERO = { x: 0, y: 0, z: 0 };
const OFFSET = { x: 10, y: 20, z: -4 };
const options = { ignoreAdvisoryControllerEvidence: true };
const report = (wire: string) => parseStatusReport(wire)!;
const fresh = (patch: Partial<LaserState> = {}): LaserState => ({
  ...useLaserStore.getState(),
  ...initialLaserState(),
  statusReport: report('<Idle|MPos:31.000,42.000,3.000>'),
  ...patch,
});
const current = (before: LaserState, after: Partial<LaserState>) =>
  controllerStartPreparationStillCurrent(before, { ...before, ...after }, options);

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  posted: OutputPreparationEnvelope[] = [];
  terminated = false;
  constructor() {
    ControlledWorker.instances.push(this);
  }
  postMessage(value: unknown): void {
    if (!isCanvasCompilationBridgeConnection(value)) {
      this.posted.push(value as OutputPreparationEnvelope);
    }
  }
  terminate(): void {
    this.terminated = true;
  }
  finish(): void {
    this.onmessage?.(
      new MessageEvent<OutputPreparationResult>('message', {
        data: {
          requestId: this.posted.at(-1)!.requestId,
          response: { kind: 'start', result: { ok: false, messages: ['worker completed'] } },
        },
      }),
    );
  }
}

beforeEach(() => {
  resetStore();
  resetOutputPreparationWorkerForTests();
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
  useLaserStore.setState(fresh());
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
  ControlledWorker.instances = [];
});

afterEach(() => {
  resetOutputPreparationWorkerForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preparation controller position identity', () => {
  it('accepts a first zero WCO and subsequent omitted WCO with no custom origin', () => {
    const before = fresh();
    const after = {
      ...before,
      statusReport: report('<Idle|MPos:31.000,42.000,3.000|WCO:0,0,0>'),
      wcoCache: ZERO,
    };
    expect(current(before, after)).toBe(true);
    expect(current(after, { statusReport: before.statusReport })).toBe(true);
  });

  it('accepts equivalent MPos and WPos in either direction with a stable custom offset', () => {
    const before = fresh({ wcoCache: OFFSET, workOriginActive: true, workOriginSource: 'g92' });
    const after = { ...before, statusReport: report('<Idle|WPos:21.000,22.000,7.000>') };
    expect(current(before, after)).toBe(true);
    expect(current(after, before)).toBe(true);
    expect(current(before, { statusReport: report('<Idle|MPos:31,42,3|WPos:21,22,7>') })).toBe(
      true,
    );
  });

  it.each([
    {
      units: 'mm',
      reportInches: false,
      offset: { x: 10.002, y: 20.002, z: -4.002 },
      machine: '<Idle|MPos:20.005,40.006,-1.005>',
      roundedWork: '<Idle|WPos:10.002,20.003,2.996>',
      movedWork: '<Idle|WPos:10.001,20.003,2.996>',
      movedMachine: '<Idle|MPos:20.006,40.006,-1.005>',
    },
    {
      units: 'inch',
      reportInches: true,
      offset: { x: 0.5002, y: 0.7002, z: -0.2002 },
      machine: '<Idle|MPos:1.0005,1.4006,-0.1005>',
      roundedWork: '<Idle|WPos:0.5002,0.7003,0.0996>',
      movedWork: '<Idle|WPos:0.5001,0.7003,0.0996>',
      movedMachine: '<Idle|MPos:1.0006,1.4006,-0.1005>',
    },
  ])('allows one $units reporting tick only for MPos/WCO conversion', (sample) => {
    const before = fresh({
      controllerSettings: { reportInches: sample.reportInches },
      wcoCache: sample.offset,
      workOriginActive: true,
      workOriginSource: 'g92',
      statusReport: report(sample.machine),
    });
    const after = { ...before, statusReport: report(sample.roundedWork) };
    expect(current(before, after)).toBe(true);
    expect(current(after, before)).toBe(true);
    expect(current(before, { statusReport: report(sample.movedWork) })).toBe(false);
    // A direct observation in the same representation has no subtraction
    // rounding: even one reported movement tick must invalidate the owner.
    expect(current(before, { statusReport: report(sample.movedMachine) })).toBe(false);
  });

  it('rejects movement when conversion has no offset rounding or an extra field disagrees', () => {
    const before = fresh({ wcoCache: ZERO });
    expect(current(before, { statusReport: report('<Idle|WPos:31.001,42,3>') })).toBe(false);
    expect(current(before, { statusReport: report('<Idle|MPos:31,42,3|WPos:32,42,3>') })).toBe(
      false,
    );
    expect(current(before, { statusReport: report('<Idle|MPos:31,42,3.001>') })).toBe(false);
  });

  it('rejects changed offset XYZ even when WPos is kept unchanged', () => {
    const before = fresh({
      wcoCache: OFFSET,
      workOriginActive: true,
      workOriginSource: 'g92',
      statusReport: report('<Idle|WPos:21,22,7>'),
    });
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(current(before, { wcoCache: { ...OFFSET, [axis]: OFFSET[axis] + 0.001 } })).toBe(
        false,
      );
    }
    expect(current(fresh(), { wcoCache: OFFSET })).toBe(false);
  });

  it('does not assume a missing custom-origin offset is zero', () => {
    for (const workOriginSource of ['g92', 'g54-persistent', 'unknown'] as const) {
      const before = fresh({ workOriginActive: true, workOriginSource });
      expect(current(before, { wcoCache: ZERO })).toBe(false);
      expect(current(before, { statusReport: report('<Idle|WPos:31,42,3>') })).toBe(false);
    }
  });

  it('keeps session, origin provenance, unit interpretation and CNC Z evidence bound', () => {
    const before = fresh({
      statusReport: report('<Idle|MPos:0,0,0>'),
      wcoCache: ZERO,
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
    });
    for (const patch of [
      { controllerSessionEpoch: before.controllerSessionEpoch + 1 },
      { trustedPositionEpoch: (before.trustedPositionEpoch ?? 0) + 1 },
      { workOriginActive: true },
      { workOriginSource: 'unknown' as const },
      { workZReferenceEpoch: before.workZReferenceEpoch + 1 },
      { workZZeroEvidence: null },
      { controllerSettings: { reportInches: true } },
      { statusReport: null },
      { statusReport: report('<Idle>') },
      { statusReport: report('<Jog|MPos:0,0,0>') },
    ]) {
      expect(current(before, patch)).toBe(false);
    }
    expect(current(before, { controllerSettings: { maxPowerS: 1000 } })).toBe(true);
  });
});

describe('equivalent position reports during owned background preparation', () => {
  const start = () => {
    vi.stubGlobal('Worker', ControlledWorker);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useStore.setState({ project: mixedCanvasCompilationProject() });
    useLaserStore.setState({ workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 } });
    return prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
    );
  };

  it('finishes the original worker across first zero WCO and equivalent WPos reports', async () => {
    const pending = start();
    const worker = ControlledWorker.instances.at(-1)!;
    useLaserStore.setState({
      wcoCache: ZERO,
      statusReport: report('<Idle|MPos:31,42,3|WCO:0,0,0>'),
    });
    useLaserStore.setState({ statusReport: report('<Idle|WPos:31,42,3>') });
    const retired = worker.terminated;
    if (!retired) worker.finish();
    const result = await pending;
    expect(retired).toBe(false);
    expect(ControlledWorker.instances).toHaveLength(1);
    expect(result).toEqual({ ok: false, messages: ['worker completed'] });
  });

  it('retires the worker after a real offset change', async () => {
    useLaserStore.setState({ wcoCache: ZERO });
    const pending = start();
    const worker = ControlledWorker.instances.at(-1)!;
    useLaserStore.setState({
      wcoCache: { ...ZERO, z: 0.001 },
      statusReport: report('<Idle|MPos:31,42,3|WCO:0,0,0.001>'),
    });
    const retired = worker.terminated;
    if (!retired) worker.finish();
    const result = await pending;
    expect(retired).toBe(true);
    expect(result).toEqual({ ok: false, messages: [STALE_START_PREPARATION_MESSAGE] });
  });
});
