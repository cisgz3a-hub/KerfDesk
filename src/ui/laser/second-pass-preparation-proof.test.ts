import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import type { LaserSecondPassSelection } from '../../core/laser-second-pass';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type ExecutionArtifactV1 } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import { frameLaserSecondPass } from './second-pass-execution';
import { createSecondPassExecutionFixture } from './second-pass-execution-testing';
import { SecondPassWorkerClient } from './second-pass/second-pass-worker-client';
import {
  registerVerifiedLaserSecondPassPreparation,
  verifiedLaserSecondPassPreparation,
} from './second-pass-preparation-proof';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalFrame = useLaserStore.getState().frame;
beforeEach(() => {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    controllerSessionEpoch: 7,
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    statusReport: idleControllerStatusForFrameTest(),
    activeWcs: 'G54',
    frame: vi.fn(async () => undefined),
  });
});
afterEach(() => {
  useLaserStore.setState({ ...initialLaserState(), frame: originalFrame });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type SourceMutation = {
  name: string;
  apply: (source: ExecutionArtifactV1, selection: LaserSecondPassSelection) => void;
};
const MUTATIONS: SourceMutation[] = [
  {
    name: 'recovery history',
    apply: (source) => Object.assign(source, { laserResumeChain: [{ fromLine: 1 }] }),
  },
  {
    name: 'inherited painted history',
    apply: (source, selection) =>
      Object.assign(source, {
        laserSecondPassChain: [
          {
            sourceRunId: source.runId,
            sourceFingerprint: source.fingerprint,
            resumeChainBefore: [],
            selection,
          },
        ],
      }),
  },
  {
    name: 'original controller observation',
    apply: (source) =>
      Object.assign(source.archivedControllerObservation, { wco: { x: 5, y: 6, z: 0 } }),
  },
  {
    name: 'output scope in place',
    apply: (source) => Object.assign(source.outputScope, { useSelectionOrigin: true }),
  },
  {
    name: 'original placement in place',
    apply: (source) => Object.assign(source.jobOrigin ?? {}, { anchor: 'center' }),
  },
  {
    name: 'canonical profile in place',
    apply: (source) => Object.assign(source.prepared.project.device, { maxPowerS: 900 }),
  },
  {
    name: 'provenance in place',
    apply: (source) => Object.assign(source.provenance?.controller ?? {}, { sessionEpoch: 99 }),
  },
];

describe('second-pass verified preparation ownership', () => {
  it.each(MUTATIONS)('rejects changed $name after worker verification', async ({ apply }) => {
    const { source, prepared, selection } = await fixture();
    registerVerifiedLaserSecondPassPreparation(source, prepared, selection);
    expect(verifiedLaserSecondPassPreparation(source, prepared, selection)).not.toBeNull();

    apply(source, selection);

    expect(verifiedLaserSecondPassPreparation(source, prepared, selection)).toBeNull();
  });

  it('retains canonical worker metadata after the public preview objects change', async () => {
    const { source, prepared, selection } = await fixture();
    const expected = structuredClone({
      profile: prepared.prepared.project.device,
      origin: prepared.jobOrigin,
      mapping: prepared.canvasPlan.coordinateFrame,
      metrics: prepared.metrics,
    });
    registerVerifiedLaserSecondPassPreparation(source, prepared, selection);
    Object.assign(prepared.prepared.project.device, { origin: 'front-right', maxPowerS: 50 });
    Object.assign(prepared.jobOrigin ?? {}, { anchor: 'center' });
    Object.assign(prepared.canvasPlan.coordinateFrame, { jobOriginOffset: { x: 999, y: 999 } });
    Object.assign(prepared.metrics, {
      frameMotionBounds: { minX: 900, maxX: 901, minY: 900, maxY: 901 },
    });

    const verified = verifiedLaserSecondPassPreparation(source, prepared, selection);

    expect(verified?.prepared.project.device).toEqual(expected.profile);
    expect(verified?.jobOrigin).toEqual(expected.origin);
    expect(verified?.canvasPlan.coordinateFrame).toEqual(expected.mapping);
    expect(verified?.metrics).toEqual(expected.metrics);
    expect(verified?.prepared.job).toBe(prepared.prepared.job);
  });

  it('does not serialize the raster scene while capturing or matching proof metadata', async () => {
    const { source, prepared, selection } = await fixture();
    Object.defineProperty(source.prepared.project.scene, 'toJSON', {
      value: () => {
        throw new Error('Do not serialize the prepared raster project on Frame.');
      },
    });
    registerVerifiedLaserSecondPassPreparation(source, prepared, selection);
    expect(verifiedLaserSecondPassPreparation(source, prepared, selection)).not.toBeNull();
  });

  it('refuses source drift during asynchronous Frame geometry qualification before motion', async () => {
    const { source, prepared, selection } = await fixture();
    registerVerifiedLaserSecondPassPreparation(
      source,
      prepared,
      selection,
      async (initialPosition) => {
        await Promise.resolve();
        Object.assign(source, { laserResumeChain: [{ fromLine: 1 }] });
        return {
          manifest: buildMotionManifest(prepared.gcode, { machineKind: 'laser', initialPosition }),
          duration: prepared.metrics.duration,
        };
      },
    );

    expect(await frameLaserSecondPass(source, prepared, selection)).toBeNull();
    expect(useLaserStore.getState().frame).not.toHaveBeenCalled();
  });
});

describe('second-pass worker source ownership', () => {
  it('does not register a source changed while its worker copy was being verified', async () => {
    const { source } = await fixture();
    const { client, worker } = mockWorkerClient();
    const opened = client.open(source);
    Object.assign(source.outputScope, { useSelectionOrigin: true });
    worker.reply({});
    await expect(opened).rejects.toThrow('source changed');
    client.close();
  });

  it('does not register a preview against changed source metadata during compilation', async () => {
    const { source, prepared, selection } = await fixture();
    const { client, worker } = mockWorkerClient();
    const opened = client.open(source);
    worker.reply({});
    await opened;
    const compiled = client.compile(selection);
    Object.assign(source, { laserResumeChain: [{ fromLine: 1 }] });
    worker.reply({ prepared, drawing: {}, burnLengthMm: 1 });
    await expect(compiled).rejects.toThrow('source changed');
    expect(verifiedLaserSecondPassPreparation(source, prepared, selection)).toBeNull();
    client.close();
  });
});

class TestWorker {
  static latest: TestWorker;
  onmessage: ((event: MessageEvent<{ id: number; value: unknown }>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private requestId = 0;
  constructor() {
    TestWorker.latest = this;
  }
  postMessage(request: { id: number }): void {
    this.requestId = request.id;
  }
  terminate(): void {
    /* The deterministic test transport owns no background process. */
  }
  reply(value: unknown): void {
    this.onmessage?.({ data: { id: this.requestId, value } } as MessageEvent<{
      id: number;
      value: unknown;
    }>);
  }
}

function mockWorkerClient() {
  vi.stubGlobal('Worker', TestWorker);
  const client = new SecondPassWorkerClient();
  return { client, worker: TestWorker.latest };
}

async function fixture() {
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  const result = await createSecondPassExecutionFixture(repository, {
    startFrom: 'current-position',
    anchor: 'front-left',
    currentPosition: { x: 31, y: 42 },
  });
  // A worker result is a separate structured clone from the archived source.
  return {
    source: structuredClone(result.source),
    prepared: structuredClone(result.prepared),
    selection: structuredClone(result.selection),
  };
}
