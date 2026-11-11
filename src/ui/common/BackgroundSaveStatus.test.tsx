import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { useBackgroundSaveHealth } from '../state/background-save-health';
import { useUiStore } from '../state/ui-store';
import { StatusBar } from './StatusBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const AUTOSAVE_TEXT =
  'Autosave could not preserve the newest project. Save the .lf2 file manually.';
const MACHINE_TEXT = 'Your machine settings could not be saved for next session.';
const WAITING_TEXT = 'Autosave is waiting for the job to end.';

let mounted: { readonly host: HTMLDivElement; readonly root: Root } | null = null;

afterEach(async () => {
  if (mounted !== null) {
    const { host, root } = mounted;
    await act(async () => root.unmount());
    host.remove();
    mounted = null;
  }
  useBackgroundSaveHealth.setState({ signs: {} });
  useStore.getState().newProject();
  useUiStore.getState().resetView();
});

async function renderStatusBar(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<StatusBar />));
  mounted = { host, root };
  return host;
}

function signs(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.lf-status-bar__alert')];
}

describe('status bar sign for a failing background save (A5-P2-1)', () => {
  it('shows nothing while background saves are healthy', async () => {
    const host = await renderStatusBar();
    expect(signs(host)).toEqual([]);
  });

  it('stays while the last autosave failed and goes with the next good write', async () => {
    const host = await renderStatusBar();

    await act(async () => useBackgroundSaveHealth.getState().noteFailed('autosave', AUTOSAVE_TEXT));
    const [sign] = signs(host);
    expect(sign?.textContent).toContain('Autosave failed');
    // The tooltip carries the cause and what to do, and says when the sign goes.
    expect(sign?.title).toContain(AUTOSAVE_TEXT);
    expect(sign?.title).toContain('until an autosave succeeds or the project is saved');
    // Reachable without a mouse, and announced when it appears.
    expect(sign?.getAttribute('role')).toBe('status');
    expect(sign?.tabIndex).toBe(0);
    expect(sign?.getAttribute('aria-label')).toContain(AUTOSAVE_TEXT);

    // A second failure of the same kind is still one sign.
    await act(async () => useBackgroundSaveHealth.getState().noteFailed('autosave', AUTOSAVE_TEXT));
    expect(signs(host)).toHaveLength(1);

    await act(async () => useBackgroundSaveHealth.getState().noteSaved('autosave'));
    expect(signs(host)).toEqual([]);
  });

  it('says an autosave is waiting for a job, and lets a failure outrank it', async () => {
    const host = await renderStatusBar();
    const health = useBackgroundSaveHealth.getState();

    await act(async () => health.noteWaiting('autosave', WAITING_TEXT));
    const [sign] = signs(host);
    expect(sign?.textContent).toContain('Autosave waiting for job');
    expect(sign?.dataset['state']).toBe('waiting');
    expect(sign?.title).toContain(WAITING_TEXT);
    expect(sign?.title).toContain('until the job ends or the project is saved');

    // The copy that did not happen is the stronger fact.
    await act(async () => health.noteFailed('autosave', AUTOSAVE_TEXT));
    await act(async () => health.noteWaiting('autosave', WAITING_TEXT));
    expect(signs(host)[0]?.textContent).toContain('Autosave failed');
    await act(async () => health.noteWaiting('autosave', null));
    expect(signs(host)[0]?.textContent).toContain('Autosave failed');

    await act(async () => health.noteSaved('autosave'));
    await act(async () => health.noteWaiting('autosave', WAITING_TEXT));
    await act(async () => health.noteWaiting('autosave', null));
    expect(signs(host)).toEqual([]);
  });

  it('sits in the fixed action rail, not in the telemetry line that scrolls', async () => {
    const host = await renderStatusBar();
    await act(async () => useBackgroundSaveHealth.getState().noteFailed('autosave', AUTOSAVE_TEXT));
    const [sign] = signs(host);
    expect(sign?.closest('.lf-status-bar__actions')).not.toBeNull();
    expect(sign?.closest('.lf-status-bar__telemetry')).toBeNull();
  });

  it('shows machine settings that could not be saved with the same sign', async () => {
    const host = await renderStatusBar();
    await act(async () => {
      useBackgroundSaveHealth.getState().noteFailed('autosave', AUTOSAVE_TEXT);
      useBackgroundSaveHealth.getState().noteFailed('machine-settings', MACHINE_TEXT);
    });
    expect(signs(host).map((sign) => sign.textContent)).toEqual([
      expect.stringContaining('Autosave failed'),
      expect.stringContaining('Machine settings not saved'),
    ]);
    expect(signs(host)[1]?.title).toContain(MACHINE_TEXT);
    expect(signs(host)[1]?.title).toContain('saving the project keeps them in its file');

    // Each kind clears on its own.
    await act(async () => useBackgroundSaveHealth.getState().noteSaved('autosave'));
    expect(signs(host).map((sign) => sign.textContent)).toEqual([
      expect.stringContaining('Machine settings not saved'),
    ]);
  });
});

describe('useBackgroundSaveHealth', () => {
  it('does not notify subscribers for a good write or an idle tick while all is well', () => {
    let notified = 0;
    const unsubscribe = useBackgroundSaveHealth.subscribe(() => {
      notified += 1;
    });
    useBackgroundSaveHealth.getState().noteSaved('autosave');
    useBackgroundSaveHealth.getState().noteSaved('machine-settings');
    useBackgroundSaveHealth.getState().noteWaiting('autosave', null);
    unsubscribe();
    expect(notified).toBe(0);
  });

  it('does not notify again for the same sign', () => {
    const health = useBackgroundSaveHealth.getState();
    health.noteWaiting('autosave', 'waiting');
    health.noteFailed('machine-settings', 'failed');
    let notified = 0;
    const unsubscribe = useBackgroundSaveHealth.subscribe(() => {
      notified += 1;
    });
    health.noteWaiting('autosave', 'waiting');
    health.noteFailed('machine-settings', 'failed');
    unsubscribe();
    expect(notified).toBe(0);
  });

  it('keeps the newest cause of a failure', () => {
    const { noteFailed } = useBackgroundSaveHealth.getState();
    noteFailed('autosave', 'first cause');
    noteFailed('autosave', 'second cause');
    expect(useBackgroundSaveHealth.getState().signs).toEqual({
      autosave: { state: 'failed', message: 'second cause' },
    });
  });
});
