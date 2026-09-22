import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { buildCanvasMotionPlan, mapControllerPointToScene } from '../state/canvas-motion-plan';
import {
  isCurrentExecutionArtifact,
  type ExecutionArtifactV1,
} from '../state/recovery/execution-artifact';
import { executionArtifactIntegrityIsValid } from '../state/recovery/execution-artifact-integrity';
import { packMotionManifest, unpackMotionManifest } from '../state/recovery/packed-motion-manifest';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { pickRecoveryMovement } from './laser-recovery-picker-model';
import {
  packedManifestTransferables,
  packRecoveryPreviewManifest,
  type LaserRecoveryPreviewReply,
  type LaserRecoveryPreviewRequest,
} from './laser-recovery-preview-protocol';
import {
  buildLaserRecoveryPreviewRoute,
  configureLaserRecoveryPreviewWorkerForTests,
  laserRecoveryPreviewMapping,
  peekLaserRecoveryPreviewRoute,
  prepareLaserRecoveryPreviewRoute,
  prepareLaserRecoveryPreviewRouteNow,
  recoveryRouteFromCanvasPlan,
} from './laser-recovery-preview-route';

const PROGRAM = 'G21\nG90\nM4 S0\nG0 X10 Y20\nG1 X20 S300\nS0\nG0 Y21\nG1 X10 S400\nM5';

/** Stands in for the browser worker: the test runs the real worker logic on
 * the captured request, so the reply is the genuine packed route. */
class FakePreviewWorker {
  request: LaserRecoveryPreviewRequest | null = null;
  terminated = false;
  onmessage: ((event: MessageEvent<LaserRecoveryPreviewReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage(request: LaserRecoveryPreviewRequest): void {
    this.request = request;
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: LaserRecoveryPreviewReply): void {
    this.onmessage?.({ data } as MessageEvent<LaserRecoveryPreviewReply>);
  }
  answer(): void {
    if (this.request === null) throw new Error('No request reached the worker.');
    this.reply({ value: packRecoveryPreviewManifest(this.request) });
  }
}

function installFakeWorkers(): FakePreviewWorker[] {
  const workers: FakePreviewWorker[] = [];
  configureLaserRecoveryPreviewWorkerForTests(() => {
    const worker = new FakePreviewWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return workers;
}

afterEach(() => {
  configureLaserRecoveryPreviewWorkerForTests(undefined);
});

describe('sealed laser restart preview', () => {
  it.each(['plain', 'packed'] as const)(
    'ignores altered %s diagnostic geometry and uses the sealed program and profile',
    async (encoding) => {
      const project = createProject();
      const prepared = {
        ok: true,
        project,
        job: { groups: [] },
        jobOriginOffset: { x: 0, y: 0 },
      } as Extract<PreparedOutput, { readonly ok: true }>;
      const canvasPlan = buildCanvasMotionPlan({
        prepared,
        gcode: PROGRAM,
        machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
      });
      const artifact = await createCurrentTestExecutionArtifact({
        runId: `preview-${encoding}`,
        gcode: PROGRAM,
        prepared,
        canvasPlan,
      });
      const alteredManifest = {
        ...canvasPlan.manifest,
        blocks: canvasPlan.manifest.blocks.map((block, index) => ({
          ...block,
          // A finite, in-range, monotonic edit passes the diagnostic shape guard.
          rawLineIndex: index === 1 ? block.rawLineIndex + 1 : block.rawLineIndex,
          points: block.points.map((point) => ({ ...point, x: point.x + 1_000 })),
        })),
      };
      const alteredCanvas = {
        ...canvasPlan,
        device: { ...project.device, origin: 'front-right' as const },
        coordinateFrame: { kind: 'relative' as const, jobOriginOffset: { x: 999, y: 888 } },
      };
      const altered: ExecutionArtifactV1 = {
        ...artifact,
        canvasPlan:
          encoding === 'packed'
            ? { ...alteredCanvas, manifest: packMotionManifest(alteredManifest) }
            : { ...alteredCanvas, manifest: alteredManifest },
      };
      expect(isCurrentExecutionArtifact(altered)).toBe(true);
      expect(await executionArtifactIntegrityIsValid(altered)).toBe(true);
      const preview = buildLaserRecoveryPreviewRoute(altered);
      expect(preview).toEqual(buildLaserRecoveryPreviewRoute(artifact));
      expect(laserRecoveryPreviewMapping(altered)).toEqual({
        device: project.device,
        coordinateFrame: { kind: 'relative', jobOriginOffset: artifact.prepared.jobOriginOffset },
      });
      const point = mapControllerPointToScene({ x: 15, y: 20, z: 0 }, preview);
      expect(pickRecoveryMovement(preview, point, 0.01, 1)).toBe(5);
      // Without a worker the route is derived on this thread once and retained.
      const now = prepareLaserRecoveryPreviewRouteNow(altered);
      expect(now).not.toBeNull();
      expect(await prepareLaserRecoveryPreviewRoute(altered)).toBe(now);
      expect(peekLaserRecoveryPreviewRoute(altered)).toBe(now);
    },
  );

  it('uses the sealed reported work position and units for an incremental first movement', async () => {
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'preview-inches-observation',
      gcode: 'G21\nG91\nM4 S300\nG1 X10\nM5',
      controllerSettings: { reportInches: true },
      controllerObservation: {
        statusReport: {
          state: 'Idle',
          subState: null,
          mPos: null,
          wPos: { x: 1, y: 2, z: 0 },
          wco: { x: 0.5, y: 0.25, z: 0 },
          feed: 0,
          spindle: 0,
        },
      },
    });
    const preview = buildLaserRecoveryPreviewRoute(artifact);
    expect(unpackMotionManifest(preview.manifest).blocks[0]?.points).toEqual([
      { x: 25.4, y: 50.8, z: 0 },
      { x: 35.4, y: 50.8, z: 0 },
    ]);
    expect(preview.coordinateFrame).toEqual({
      kind: 'relative',
      jobOriginOffset: artifact.prepared.jobOriginOffset,
    });
  });

  it('packs a freshly prepared plan for the manual restart preview and refuses marker-only plans', () => {
    const project = createProject();
    const prepared = {
      ok: true,
      project,
      job: { groups: [] },
      jobOriginOffset: { x: 0, y: 0 },
    } as Extract<PreparedOutput, { readonly ok: true }>;
    const plan = buildCanvasMotionPlan({
      prepared,
      gcode: PROGRAM,
      machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
    });
    const route = recoveryRouteFromCanvasPlan(plan);
    if (route === null) throw new Error('Expected a packed manual restart route.');
    expect(unpackMotionManifest(route.manifest)).toEqual(plan.manifest);
    expect(route.capability).toBe('file-only');
    expect(route.device).toBe(plan.device);
    const markerOnly = { ...plan, manifest: undefined } as unknown as typeof plan;
    expect(recoveryRouteFromCanvasPlan(markerOnly)).toBeNull();
  });

  it('derives the route in a worker, transfers it back, and caches it per artifact', async () => {
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'preview-worker',
      gcode: PROGRAM,
    });
    const workers = installFakeWorkers();
    expect(prepareLaserRecoveryPreviewRouteNow(artifact)).toBeNull();
    expect(peekLaserRecoveryPreviewRoute(artifact)).toBeNull();
    const pending = prepareLaserRecoveryPreviewRoute(artifact);
    expect(prepareLaserRecoveryPreviewRoute(artifact)).toBe(pending);
    expect(workers).toHaveLength(1);
    const worker = workers[0];
    if (worker === undefined || worker.request === null) throw new Error('Expected a request.');
    expect(worker.request).toEqual({ gcode: artifact.gcode, initialPosition: null });
    expect(packedManifestTransferables(packRecoveryPreviewManifest(worker.request))).toHaveLength(
      2,
    );
    worker.answer();
    const route = await pending;
    expect(unpackMotionManifest(route.manifest)).toEqual(
      unpackMotionManifest(buildLaserRecoveryPreviewRoute(artifact).manifest),
    );
    expect(worker.terminated).toBe(true);
    expect(peekLaserRecoveryPreviewRoute(artifact)).toBe(route);
    expect(prepareLaserRecoveryPreviewRouteNow(artifact)).toBe(route);
    expect(workers).toHaveLength(1);
  });

  it('reports a worker failure, terminates the worker, and allows a retry', async () => {
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'preview-worker-failure',
      gcode: PROGRAM,
    });
    const workers = installFakeWorkers();
    const pending = prepareLaserRecoveryPreviewRoute(artifact);
    workers[0]?.reply({ error: 'Source line 3: Unsupported G2.' });
    await expect(pending).rejects.toThrow('Unsupported G2');
    expect(workers[0]?.terminated).toBe(true);
    expect(peekLaserRecoveryPreviewRoute(artifact)).toBeNull();
    const retry = prepareLaserRecoveryPreviewRoute(artifact);
    expect(workers).toHaveLength(2);
    workers[1]?.answer();
    const route = await retry;
    expect(peekLaserRecoveryPreviewRoute(artifact)).toBe(route);
  });

  it('rejects a worker reply that is not a valid packed route', async () => {
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'preview-worker-invalid',
      gcode: PROGRAM,
    });
    const workers = installFakeWorkers();
    const pending = prepareLaserRecoveryPreviewRoute(artifact);
    workers[0]?.reply({
      value: { encoding: 'packed-motion-manifest-v1' },
    } as unknown as LaserRecoveryPreviewReply);
    await expect(pending).rejects.toThrow('invalid route');
    expect(workers[0]?.terminated).toBe(true);
  });
});
