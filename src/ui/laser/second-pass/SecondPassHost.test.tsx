import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../../core/controllers/grbl';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../../core/scene';
import { Dialog } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserSecondPassUiStore } from '../../state/laser-second-pass-ui-store';
import { RecoveryRepository, type ExecutionArtifactV1 } from '../../state/recovery';
import { MemoryRecoveryStorageBackend } from '../../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../../state/recovery/testing/execution-artifact-test-fixture';
import { useUiStore } from '../../state/ui-store';
import { SecondPassControl } from './SecondPassControl';
import { SecondPassHost } from './SecondPassHost';

// The real archived source and modal ownership run here. Geometry, worker and
// machine actions are independently covered by the workbench and browser tests.
vi.mock('./SecondPassWorkbench', () => ({
  SecondPassWorkbench: (props: { source: ExecutionArtifactV1; onClose: () => void }) => (
    <Dialog title="Paint a second pass" onClose={props.onClose}>
      <p data-testid="opened-source">{props.source.runId}</p>
      <button onClick={props.onClose}>Close editor</button>
    </Dialog>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-09-22T02:00:00.000Z';
let repository: RecoveryRepository;
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  useLaserStore.setState(initialLaserState());
  useLaserSecondPassUiStore.setState({
    completionRunId: null,
    lastOfferedRunId: null,
    editorRequest: null,
  });
  useUiStore.setState({ modalDepth: 0, imageDialog: null, textDialog: null });
  repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
  await repository.initialize();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  useLaserStore.setState(initialLaserState());
  useLaserSecondPassUiStore.setState({
    completionRunId: null,
    lastOfferedRunId: null,
    editorRequest: null,
  });
});

async function complete(runId: string, project = createProject()): Promise<ExecutionArtifactV1> {
  const artifact = await createCurrentTestExecutionArtifact({ runId, createdAtIso: NOW, project });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect((await repository.activateFreshRun(runId, NOW)).ok).toBe(true);
  expect(await repository.completeRun(runId, NOW)).toEqual({ ok: true, value: true });
  return artifact;
}

async function render(rail = false): Promise<void> {
  await act(async () => {
    root.render(
      <StrictMode>
        {rail && <SecondPassControl busy={false} machineKind="laser" repository={repository} />}
        <SecondPassHost repository={repository} />
      </StrictMode>,
    );
  });
}

async function offer(runId: string): Promise<void> {
  await act(async () => useLaserSecondPassUiStore.getState().offerCompletion(runId));
}

function button(label: string): HTMLButtonElement {
  const value = Array.from(host.querySelectorAll('button')).find(
    (node) => node.textContent === label,
  );
  if (!value) throw new Error(`Missing button: ${label}`);
  return value;
}

describe('completed-job second pass offer', () => {
  it('does not prompt for hydrated history, but opens once for a newly completed laser run', async () => {
    await complete('saved');
    await render();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await offer('saved');
    expect(host.textContent).toContain('Would you like to darken selected areas?');
    expect(useUiStore.getState().modalDepth).toBe(1);
    await act(async () => button('Done').click());
    await offer('saved');
    await render();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe('saved');
  });

  it('waits for the exact delayed receipt instead of offering the previous completion', async () => {
    await complete('older');
    await render();
    await offer('newer');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      await complete('newer');
    });
    expect(host.textContent).toContain('Would you like to darken selected areas?');
    await act(async () => button('Darken selected areas…').click());
    expect(host.querySelector('[data-testid="opened-source"]')?.textContent).toBe('newer');
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(useUiStore.getState().modalDepth).toBe(1);
  });

  it('does not offer darkening for a completed CNC run', async () => {
    const project: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    await complete('cnc', project);
    await render();
    await offer('cnc');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(useLaserSecondPassUiStore.getState().completionRunId).toBeNull();
  });

  it('offers another completion after the previous prompt was dismissed', async () => {
    await complete('first');
    await render();
    await offer('first');
    await act(async () => button('Done').click());
    await act(async () => {
      await complete('second');
    });
    await offer('second');
    expect(host.textContent).toContain('Would you like to darken selected areas?');
  });

  it('defers behind another dialog and controller settlement without reacting to its own modal', async () => {
    await complete('settled');
    useUiStore.setState({ modalDepth: 1 });
    useLaserStore.setState({
      controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 1 },
    });
    await render();
    await offer('settled');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => useUiStore.setState({ modalDepth: 0 }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => useLaserStore.setState({ controllerOperation: null }));
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () => useLaserStore.setState({ log: [] }));
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('drops a deferred offer when another run begins', async () => {
    await complete('old');
    useUiStore.setState({ modalDepth: 1 });
    await render();
    await offer('old');
    await act(async () =>
      useLaserStore.setState({
        activeRunId: 'next',
        streamer: createStreamer('G1 X1'),
      }),
    );
    await act(async () => {
      useLaserStore.setState({ activeRunId: null, streamer: null });
      useUiStore.setState({ modalDepth: 0 });
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(useLaserSecondPassUiStore.getState().completionRunId).toBeNull();
  });

  it('offers the new completed job even when an older job is selected in the rail', async () => {
    await complete('old');
    await complete('new');
    await render(true);
    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'old';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await offer('new');
    await act(async () => button('Darken selected areas…').click());
    expect(host.querySelector('[data-testid="opened-source"]')?.textContent).toBe('new');
    await act(async () => button('Close editor').click());
    await act(async () => button('Paint a second pass…').click());
    expect(host.querySelector('[data-testid="opened-source"]')?.textContent).toBe('old');
  });

  it('keeps an opened editor mounted when the Machine rail is collapsed', async () => {
    await complete('saved');
    await render(true);
    await act(async () => button('Paint a second pass…').click());
    await render(false);
    expect(host.querySelector('[data-testid="opened-source"]')?.textContent).toBe('saved');
  });

  it('cancels an archive opening on close and ignores its late result', async () => {
    const artifact = await complete('delayed');
    let resolve!: (result: { ok: true; value: ExecutionArtifactV1 }) => void;
    vi.spyOn(repository, 'getArchivedExecution').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await render();
    await offer('delayed');
    await act(async () => button('Darken selected areas…').click());
    expect(host.textContent).toContain('Opening saved job…');
    await act(async () => button('Close').click());
    await act(async () => resolve({ ok: true, value: artifact }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('returns focus after Escape and leaves the completed archive available', async () => {
    await complete('saved');
    await render(true);
    const launcher = button('Paint a second pass…');
    launcher.focus();
    await offer('saved');
    expect(document.activeElement).toBe(button('Done'));
    await act(async () =>
      button('Done').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      ),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe('saved');
  });

  it.each(['manual', 'completion'] as const)(
    'restores the workspace opener after the %s editor loading and dialog replacements',
    async (entry) => {
      await complete('saved');
      await render(true);
      const opener = document.createElement('button');
      opener.textContent = 'Workspace selection';
      document.body.appendChild(opener);
      try {
        opener.focus();
        if (entry === 'completion') {
          await offer('saved');
          await act(async () => button('Darken selected areas…').click());
        } else await act(async () => button('Paint a second pass…').click());
        expect(host.querySelector('[data-testid="opened-source"]')).not.toBeNull();
        await act(async () => button('Close editor').click());
        expect(document.activeElement).toBe(opener);
      } finally {
        opener.remove();
      }
    },
  );

  it('cancels an opening when a newer live run starts before the archive read finishes', async () => {
    const artifact = await complete('old');
    let resolve!: (result: { ok: true; value: ExecutionArtifactV1 }) => void;
    vi.spyOn(repository, 'getArchivedExecution').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await render();
    await offer('old');
    await act(async () => button('Darken selected areas…').click());
    await act(async () =>
      useLaserStore.setState({ activeRunId: 'new', streamer: createStreamer('G1 X1') }),
    );
    await act(async () => resolve({ ok: true, value: artifact }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(useLaserSecondPassUiStore.getState().editorRequest).toBeNull();
  });
});
