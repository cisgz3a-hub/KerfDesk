import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { useStore } from '../state';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { FRAME_JOB_FIRST_MESSAGE, framedRunReadinessIssue } from './framed-run-readiness';
import { currentReplayExecutionSignature, RunAgainControl } from './RunAgainControl';

import type * as FramedRunReadiness from './framed-run-readiness';

// Run again unlocks like Start, on a ready Frame permit (ADR-372 Amendment 1).
// These cases are about the replay offer itself, so the permit reads as ready
// unless a case says otherwise.
vi.mock('./framed-run-readiness', async (importOriginal) => {
  const actual = await importOriginal<typeof FramedRunReadiness>();
  return { ...actual, framedRunReadinessIssue: vi.fn(() => null) };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.mocked(framedRunReadinessIssue).mockReturnValue(null);
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.getState().resetFeatures();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.getState().resetFeatures();
  vi.clearAllMocks();
});

describe('RunAgainControl', () => {
  it('offers exact completed-job replay and delegates the immutable receipt once', async () => {
    const repository = await completedRepository();
    const receipt = repository.getSnapshot().lastCompletedReceipt;
    expect(receipt).not.toBeNull();
    let release: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onRunAgain = vi.fn(async () => pending);
    render(repository, onRunAgain);

    expect(button('Run same job again from start').disabled).toBe(false);
    act(() => button('Run same job again from start').click());
    act(() => button('Checking completed job…').click());

    expect(onRunAgain).toHaveBeenCalledTimes(1);
    expect(onRunAgain).toHaveBeenCalledWith(receipt);
    expect(button('Checking completed job…').disabled).toBe(true);

    await act(async () => {
      release?.();
      await pending;
    });
    expect(button('Run same job again from start').disabled).toBe(false);
  });

  it.each([
    ['placement', () => useStore.getState().setJobPlacement({ anchor: 'center' })],
    [
      'output scope',
      () => useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true }),
    ],
    [
      'machine profile',
      () => {
        const current = useStore.getState().project.device.maxFeed;
        useStore.getState().updateDeviceProfile({ maxFeed: current + 1 });
      },
    ],
  ])(
    'hides the exact replay offer after a %s change without destroying the sealed receipt',
    async (_name, change) => {
      const repository = await completedRepository();
      render(
        repository,
        vi.fn(async () => undefined),
      );
      expect(button('Run same job again from start')).toBeDefined();

      act(() => change());

      expect(host?.textContent).not.toContain('Run same job again from start');
      expect(repository.getSnapshot().lastCompletedReceipt).not.toBeNull();
    },
  );

  it('stays greyed out until a Frame of this exact job is ready, like Start', async () => {
    vi.mocked(framedRunReadinessIssue).mockReturnValue(FRAME_JOB_FIRST_MESSAGE);
    const onRunAgain = vi.fn(async () => undefined);
    render(await completedRepository(), onRunAgain);

    const runAgain = button('Run same job again from start');
    expect(runAgain.disabled).toBe(true);
    expect(runAgain.title).toContain('Press Frame job first');
    act(() => runAgain.click());
    expect(onRunAgain).not.toHaveBeenCalled();
  });

  it('does not offer replay when there is no clean-completion receipt', async () => {
    const repository = createRepository();
    await repository.initialize();
    render(
      repository,
      vi.fn(async () => undefined),
    );

    expect(host?.textContent).toBe('');
  });
});

function render(
  repository: RecoveryRepository,
  onRunAgain: (
    receipt: NonNullable<ReturnType<RecoveryRepository['getSnapshot']>['lastCompletedReceipt']>,
  ) => Promise<void>,
): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <RunAgainControl
        disabled={false}
        busy={false}
        repository={repository}
        onRunAgain={onRunAgain}
      />,
    );
  });
}

function button(label: string): HTMLButtonElement {
  const candidate = [...(host?.querySelectorAll('button') ?? [])].find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) {
    throw new Error(`Expected button: ${label}`);
  }
  return candidate;
}

function createRepository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
}

async function completedRepository(): Promise<RecoveryRepository> {
  const repository = createRepository();
  await repository.initialize();
  const app = useStore.getState();
  const executionSignature = currentReplayExecutionSignature(app);
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'run-completed-laser',
    gcode: ['G21', 'G90', 'G1 X10 S100', 'M5'].join('\n'),
    prepared: preparedProject(app.project),
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: executionSignature } as CanvasMotionPlan,
    controllerSettings: null,
    createdAtIso: NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect((await repository.activateFreshRun(artifact.runId, NOW)).ok).toBe(true);
  expect((await repository.completeRun(artifact.runId, LATER)).ok).toBe(true);
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
