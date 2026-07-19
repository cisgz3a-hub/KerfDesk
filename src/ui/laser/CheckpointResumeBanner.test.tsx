import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { useStore } from '../state';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { RECOVERY_CLAIM_LEASE_MS, RecoveryRepository } from '../state/recovery';
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

const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';
const GCODE = ['G21', 'G90', 'G1 X10 S100', 'M5'].join('\n');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('CheckpointResumeBanner', () => {
  it('shows an isolated, collapsed recovery card without a Start blocker', async () => {
    const repository = await interruptedRepository();
    render(repository);

    expect(host?.textContent).toContain('Interrupted job saved');
    expect(host?.textContent).toContain('2 of 4 lines acknowledged');
    expect(host?.textContent).toContain('isolated from the current canvas');
    expect(host?.textContent).toContain('ordinary Start');
    expect(host?.querySelector('details')?.open).toBe(false);
    expect(host?.querySelector('[role="alert"]')).toBeNull();
    expect(button('Review recovery').disabled).toBe(false);
  });

  it('renders nothing when no interrupted capsule is saved', async () => {
    const repository = createRepository();
    await repository.initialize();
    render(repository);

    expect(host?.textContent).toBe('');
  });

  it('opens and closes review without mutating the repository or either live store', async () => {
    const repository = await interruptedRepository();
    const repositoryBefore = repository.getSnapshot();
    const repositoryValueBefore = structuredClone(repositoryBefore);
    const appBefore = useStore.getState();
    const laserBefore = useLaserStore.getState();
    render(repository);

    act(() => button('Review recovery').click());
    expect(host?.textContent).toContain('Review interrupted laser job');
    expect(host?.textContent).toContain('does not change the current canvas');

    act(() => button('Close').click());
    expect(host?.textContent).not.toContain('Review interrupted laser job');
    expect(repository.getSnapshot()).toBe(repositoryBefore);
    expect(repository.getSnapshot()).toEqual(repositoryValueBefore);
    expect(useStore.getState()).toBe(appBefore);
    expect(useLaserStore.getState()).toBe(laserBefore);
  });

  it('discards only the selected recovery capsule after confirmation', async () => {
    const repository = await interruptedRepository();
    const appBefore = useStore.getState();
    const laserBefore = useLaserStore.getState();
    render(repository);

    await act(async () => {
      button('Discard').click();
      await vi.waitFor(() => expect(repository.getSnapshot().recoveryCapsule).toBeNull());
    });

    expect(jobAwareConfirm).toHaveBeenCalledWith(expect.stringContaining('Discard this'));
    expect(host?.textContent).toBe('');
    expect(useStore.getState()).toBe(appBefore);
    expect(useLaserStore.getState()).toBe(laserBefore);
  });

  it('disables both recovery actions while the controller rail is busy', async () => {
    const repository = await interruptedRepository();
    render(repository, true);

    expect(button('Review recovery').disabled).toBe(true);
    expect(button('Discard').disabled).toBe(true);
  });

  it('hides the card while a live job owns the controller', async () => {
    const repository = await interruptedRepository();
    useLaserStore.setState({
      streamer: step(createStreamer(GCODE)).state,
    });
    render(repository);

    expect(host?.textContent).toBe('');
  });

  // B4: a claim blocks Review only while its lease is live. A crash between
  // claiming and arming leaves a stale claim; the post-crash reload must not
  // permanently strand Review.
  it('keeps Review disabled while a recovery claim lease is active', async () => {
    const repository = await interruptedRepository();
    const capsule = repository.getSnapshot().recoveryCapsule;
    await repository.claimRecovery({
      runId: capsule?.runId ?? '',
      revision: capsule?.revision ?? -1,
      attemptId: 'active-attempt',
      claimedAtIso: LATER,
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(LATER) + 1_000);
    render(repository);

    expect(button('Review recovery').disabled).toBe(true);
    expect(host?.textContent).toContain('another recovery cannot start');
  });

  it('re-enables Review once the recovery claim lease has expired', async () => {
    const repository = await interruptedRepository();
    const capsule = repository.getSnapshot().recoveryCapsule;
    await repository.claimRecovery({
      runId: capsule?.runId ?? '',
      revision: capsule?.revision ?? -1,
      attemptId: 'crashed-attempt',
      claimedAtIso: LATER,
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(LATER) + RECOVERY_CLAIM_LEASE_MS + 1_000);
    render(repository);

    expect(button('Review recovery').disabled).toBe(false);
    expect(host?.textContent).not.toContain('another recovery cannot start');
  });

  it('does not offer the older capsule while a newer Start handoff is pending', async () => {
    const repository = await interruptedRepository();
    const project = useStore.getState().project;
    const candidate = await createCurrentTestExecutionArtifact({
      runId: 'run-pending-start',
      gcode: GCODE,
      prepared: preparedProject(project),
      outputScope: DEFAULT_OUTPUT_SCOPE,
      canvasPlan: { retentionKey: 'pending-signature' } as CanvasMotionPlan,
      controllerSettings: null,
      createdAtIso: LATER,
    });
    await repository.stageArtifact(candidate);
    await repository.armFreshStart(candidate.runId, LATER);
    render(repository);

    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('run-interrupted-laser');
    expect(repository.getSnapshot().pendingStart?.runId).toBe('run-pending-start');
    expect(host?.textContent).toBe('');
  });
});

function render(repository: RecoveryRepository, busy = false): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<CheckpointResumeBanner busy={busy} repository={repository} />);
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

async function interruptedRepository(): Promise<RecoveryRepository> {
  const repository = createRepository();
  await repository.initialize();
  const project = useStore.getState().project;
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'run-interrupted-laser',
    gcode: GCODE,
    prepared: preparedProject(project),
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: 'interrupted-signature' } as CanvasMotionPlan,
    controllerSettings: null,
    createdAtIso: NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect((await repository.activateFreshRun(artifact.runId, NOW)).ok).toBe(true);
  expect((await repository.updateProgress(artifact.runId, 2, LATER)).ok).toBe(true);
  expect(
    (
      await repository.interruptRun(
        artifact.runId,
        2,
        { kind: 'disconnect', message: 'USB connection was lost during the job.' },
        LATER,
      )
    ).ok,
  ).toBe(true);
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
