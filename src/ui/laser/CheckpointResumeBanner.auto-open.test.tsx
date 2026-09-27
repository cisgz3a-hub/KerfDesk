// The interrupted laser job's Review opens by itself once the controller is
// connected after a lost link or a controller failure (ADR-341 Amendment 6),
// once per run, and never after the operator's own Stop.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobInterruption } from '../../core/recovery';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { useStore } from '../state';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { CheckpointResumeBanner } from './CheckpointResumeBanner';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-09-27T10:00:00.000Z';
const LATER = '2026-09-27T10:01:00.000Z';
const GCODE = ['G21', 'G90', 'G0 X1 Y1', 'G1 X10 S100', 'M5'].join('\n');
const REVIEW_TITLE = 'Review interrupted laser job';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  vi.clearAllMocks();
});

describe('CheckpointResumeBanner opens the Review after a reconnect', () => {
  it('opens once the controller is connected, and only once per run', async () => {
    const repository = await interruptedRepository('run-auto-open', {
      kind: 'disconnect',
      message: 'USB connection was lost during the job.',
      sentLines: 4,
    });
    render(repository);
    expect(host?.textContent).toContain('Interrupted job saved');
    expect(host?.textContent).not.toContain(REVIEW_TITLE);

    act(() => useLaserStore.setState({ connection: { kind: 'connected' } }));
    expect(host?.textContent).toContain(REVIEW_TITLE);

    act(() => button('Close').click());
    expect(host?.textContent).not.toContain(REVIEW_TITLE);
    act(() => useLaserStore.setState({ connection: { kind: 'disconnected' } }));
    act(() => useLaserStore.setState({ connection: { kind: 'connected' } }));
    expect(host?.textContent).not.toContain(REVIEW_TITLE);
    expect(host?.textContent).toContain('Interrupted job saved');
  });

  it('waits while the controller rail is busy', async () => {
    const repository = await interruptedRepository('run-auto-open-busy', {
      kind: 'controller-reboot',
      message: 'The controller restarted during the job.',
    });
    useLaserStore.setState({ connection: { kind: 'connected' } });
    render(repository, true);
    expect(host?.textContent).not.toContain(REVIEW_TITLE);
    render(repository, false);
    expect(host?.textContent).toContain(REVIEW_TITLE);
  });

  it('does not open after the operator stopped the job', async () => {
    const repository = await interruptedRepository('run-auto-open-abort', {
      kind: 'cancelled',
      message: 'Stopped by the operator (Abort).',
    });
    useLaserStore.setState({ connection: { kind: 'connected' } });
    render(repository);
    expect(host?.textContent).toContain('Interrupted job saved');
    expect(host?.textContent).not.toContain(REVIEW_TITLE);
  });
});

function render(repository: RecoveryRepository, busy = false): void {
  if (host === null) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(<CheckpointResumeBanner busy={busy} repository={repository} />);
  });
}

function button(label: string): HTMLButtonElement {
  const candidate = [...(host?.querySelectorAll('button') ?? [])].find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) throw new Error(`Expected button: ${label}`);
  return candidate;
}

async function interruptedRepository(
  runId: string,
  interruption: JobInterruption,
): Promise<RecoveryRepository> {
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
  await repository.initialize();
  const artifact = await createCurrentTestExecutionArtifact({
    runId,
    gcode: GCODE,
    prepared: preparedProject(useStore.getState().project),
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: 'auto-open-signature' } as CanvasMotionPlan,
    controllerSettings: null,
    createdAtIso: NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect((await repository.activateFreshRun(runId, NOW)).ok).toBe(true);
  expect((await repository.interruptRun(runId, 2, interruption, LATER)).ok).toBe(true);
  return repository;
}

function preparedProject(project: Project): Extract<PreparedOutput, { readonly ok: true }> {
  return {
    ok: true,
    project,
    job: { groups: [] },
    jobOriginOffset: { x: 0, y: 0 },
  } as Extract<PreparedOutput, { readonly ok: true }>;
}
