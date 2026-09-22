import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryCapsule } from '../state/recovery';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { LaserRecoveryRestartPicker } from './LaserRecoveryRestartPicker';
import {
  packRecoveryPreviewManifest,
  type LaserRecoveryPreviewReply,
  type LaserRecoveryPreviewRequest,
} from './laser-recovery-preview-protocol';
import { configureLaserRecoveryPreviewWorkerForTests } from './laser-recovery-preview-route';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PROGRAM = 'G21\nG90\nM4 S0\nG0 X10 Y20\nG1 X20 S300\nS0\nG0 Y21\nG1 X10 S400\nM5';

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
}

let host: HTMLDivElement;
let root: Root;
const workers: FakePreviewWorker[] = [];

beforeEach(() => {
  workers.length = 0;
  configureLaserRecoveryPreviewWorkerForTests(() => {
    const worker = new FakePreviewWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  configureLaserRecoveryPreviewWorkerForTests(undefined);
});

async function savedCapsule(): Promise<RecoveryCapsule> {
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'picker-worker-run',
    gcode: PROGRAM,
  });
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: 2,
    sendableLines: artifact.sendableLines,
    interruption: { kind: 'disconnect', message: 'USB cable disconnected' },
    updatedAtIso: '2026-09-22T00:00:00.000Z',
    artifact,
  };
}

function renderPicker(capsule: RecoveryCapsule, onChange = vi.fn()): void {
  act(() =>
    root.render(
      <LaserRecoveryRestartPicker
        capsule={capsule}
        fromLine={undefined}
        disabled={false}
        onChange={onChange}
      />,
    ),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function lineInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('#laser-recovery-start-line');
  if (input === null) throw new Error('Expected the restart line field.');
  return input;
}

describe('LaserRecoveryRestartPicker route preparation', () => {
  it('keeps the line field usable while the worker prepares the route, then shows the canvas', async () => {
    const capsule = await savedCapsule();
    renderPicker(capsule);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'Preparing the saved route preview',
    );
    expect(host.querySelector('svg')).toBeNull();
    expect(lineInput().disabled).toBe(false);
    expect(workers).toHaveLength(1);
    const worker = workers[0];
    if (worker === undefined || worker.request === null) throw new Error('Expected a request.');
    expect(worker.request.gcode).toBe(
      capsule.artifact.kind === 'exact-execution' && capsule.artifact.gcode,
    );
    await act(async () => {
      worker.reply({
        value: packRecoveryPreviewManifest(worker.request as LaserRecoveryPreviewRequest),
      });
    });
    await settle();
    expect(host.querySelector('svg[aria-label^="Laser recovery canvas"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(worker.terminated).toBe(true);
  });

  it('falls back to the line numbers when the worker cannot prepare the route', async () => {
    const capsule = await savedCapsule();
    renderPicker(capsule);
    await act(async () => {
      workers[0]?.reply({ error: 'Source line 4: Unsupported G2.' });
    });
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unsupported G2');
    expect(host.querySelector('svg')).toBeNull();
    expect(lineInput().disabled).toBe(false);
  });

  it('reuses a prepared route immediately when the picker reopens for the same job', async () => {
    const capsule = await savedCapsule();
    renderPicker(capsule);
    const worker = workers[0];
    if (worker === undefined || worker.request === null) throw new Error('Expected a request.');
    await act(async () => {
      worker.reply({
        value: packRecoveryPreviewManifest(worker.request as LaserRecoveryPreviewRequest),
      });
    });
    await settle();
    act(() => root.unmount());
    root = createRoot(host);
    renderPicker(capsule);
    expect(host.querySelector('svg[aria-label^="Laser recovery canvas"]')).not.toBeNull();
    expect(workers).toHaveLength(1);
  });
});
