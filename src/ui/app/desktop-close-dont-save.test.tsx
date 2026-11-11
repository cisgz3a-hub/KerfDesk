// ADR-688 Amendment 3: Don't Save at the desktop close question keeps the
// unload copy under File > Recover unsaved work, and the next launch's card
// does not ask about it. Every other way a window goes away still asks.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rendererCloseRequestScript } from '../../../electron/renderer-close-request';
import { WindowCloseGuard } from '../../../electron/window-close-guard';
import type { UnsavedCloseDecision } from '../../../electron/window-unload-decision';
import { addLayer, addObject, createLayer } from '../../core/scene';
import { useStore } from '../state';
import { readAutosave, type AutosaveSnapshot } from '../state/autosave';
import { projectAutosaveService } from '../state/autosave-durable';
import { useLaserStore } from '../state/laser-store';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { resetStore, svgObj } from '../state/test-helpers';
import { AutosaveRecoveryCard } from './AutosaveRecoveryCard';
import { startedFreshFrom } from './autosave-recovery-summary';
import { DesktopCloseController, type DesktopCloseSnapshot } from './desktop-close-controller';
import { desktopCloseController } from './desktop-close-runtime';
import { useAutosave } from './use-autosave';
import { installUnloadStop } from './use-unload-stop';
import { installUnsavedChangesGuard } from './use-unsaved-changes-guard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const initialLaser = useLaserStore.getState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let removeUnloadHooks: () => void = () => undefined;

function unloadEvent(): BeforeUnloadEvent {
  return new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
}

function AutosaveProbe(): null {
  useAutosave();
  return null;
}

async function mount(element: JSX.Element): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
}

async function unmount(): Promise<void> {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

/** A window with unsaved artwork, wired as App wires it. */
async function openUnsavedWindow(save?: () => Promise<boolean>): Promise<void> {
  const project = projectWithCurrentJobSetup(useStore.getState());
  const scene = addObject(
    addLayer(project.scene, createLayer({ id: '#000000', color: '#000000' })),
    svgObj('unsaved-artwork', ['#000000']),
  );
  useStore.setState({ project: { ...project, scene }, dirty: true });
  const unload = installUnloadStop(window, save);
  const unsaved = installUnsavedChangesGuard(window);
  removeUnloadHooks = () => {
    unload();
    unsaved();
  };
  await mount(<AutosaveProbe />);
}

/**
 * The main process's own close guard, driving this window as Electron does:
 * its fixed scripts run in the page, and an allowed close unloads the page.
 */
function mainProcess(answer: UnsavedCloseDecision) {
  const result = { asked: 0, unloaded: false, kept: false };
  let onClose: (event: { preventDefault(): void }) => void = () => undefined;
  const target = {
    on(name: string, listener: (event: { preventDefault(): void }) => void): void {
      if (name === 'close') onClose = listener;
    },
    webContents: { on: (): void => undefined },
    close(): void {
      let held = false;
      onClose({ preventDefault: () => (held = true) });
      if (held) return;
      const event = unloadEvent();
      window.dispatchEvent(event);
      result.unloaded = !event.defaultPrevented;
    },
  };
  new WindowCloseGuard(target, {
    request: (operation, id) =>
      Promise.resolve(window.eval(rendererCloseRequestScript(operation, id)) as unknown),
    decideUnsaved: () => 'stay',
    decideUnsavedClose: () => {
      result.asked += 1;
      return answer;
    },
    decideUnavailable: () => 'stay',
    forceClose: () => undefined,
    isQuitRequested: () => false,
    cancelQuit: () => (result.kept = true),
    quit: () => undefined,
    reportFailure: (error) => {
      throw error;
    },
  });
  return { close: () => target.close(), result };
}

function writtenCopy(): AutosaveSnapshot {
  const copy = readAutosave();
  if (copy === null) throw new Error('Expected an unload autosave copy');
  return copy;
}

/** The next launch: an empty, untouched window whose recovery read finds `copy`. */
async function nextLaunchCards(copy: AutosaveSnapshot): Promise<number> {
  await unmount();
  removeUnloadHooks();
  removeUnloadHooks = () => undefined;
  desktopCloseController.keepOpen();
  resetStore();
  vi.spyOn(projectAutosaveService, 'readLatest').mockResolvedValue({
    snapshot: { ...copy, backend: 'local', ownership: 'abandoned' },
    warnings: [],
    unreadable: [],
  });
  await mount(<AutosaveRecoveryCard />);
  return host?.querySelectorAll('[data-autosave-recovery-card]').length ?? 0;
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  vi.spyOn(projectAutosaveService, 'session').mockResolvedValue({
    sessionId: 'close-test-window',
    ownership: 'owned',
  });
});

afterEach(async () => {
  await unmount();
  removeUnloadHooks();
  removeUnloadHooks = () => undefined;
  desktopCloseController.keepOpen();
  vi.restoreAllMocks();
  localStorage.clear();
  useLaserStore.setState(initialLaser);
  resetStore();
});

describe("Don't Save at the desktop close question (ADR-688 Amendment 3)", () => {
  it('keeps the unload copy and the next launch does not ask about it', async () => {
    await openUnsavedWindow();
    const main = mainProcess('leave');
    const closedAt = Date.now();
    main.close();
    await vi.waitFor(() => expect(main.result.unloaded).toBe(true));

    expect(main.result.asked).toBe(1);
    const copy = writtenCopy();
    expect(copy.project.scene.objects.map((object) => object.id)).toEqual(['unsaved-artwork']);
    expect(copy.savedAt).toBeGreaterThanOrEqual(closedAt);
    expect(startedFreshFrom(copy)).toBe(true);
    // Only the copy this close wrote: an earlier copy of the session, and any
    // later one, are still asked about.
    expect(startedFreshFrom({ ...copy, savedAt: copy.savedAt - 1 })).toBe(false);

    expect(await nextLaunchCards(copy)).toBe(0);
    // File > Recover unsaved work reads the same storage, which still holds it.
    expect(readAutosave()?.savedAt).toBe(copy.savedAt);
  });

  it('still asks about work autosaved after that close, as after a crash', async () => {
    await openUnsavedWindow();
    const main = mainProcess('leave');
    main.close();
    await vi.waitFor(() => expect(main.result.unloaded).toBe(true));
    const copy = writtenCopy();

    expect(await nextLaunchCards({ ...copy, savedAt: copy.savedAt + 30_000 })).toBe(1);
  });

  it('asks at the next launch after Cancel and a later unload nobody answered', async () => {
    await openUnsavedWindow();
    const main = mainProcess('stay');
    main.close();
    await vi.waitFor(() => expect(main.result.kept).toBe(true));
    expect(main.result.unloaded).toBe(false);
    expect(readAutosave()).toBeNull();

    // A reload, a browser's own "Leave site?" or a forced end of the window.
    window.dispatchEvent(unloadEvent());
    const copy = writtenCopy();
    expect(startedFreshFrom(copy)).toBe(false);
    expect(await nextLaunchCards(copy)).toBe(1);
  });

  it('writes nothing to ask about after Save', async () => {
    await openUnsavedWindow(async () => {
      useStore.setState({ dirty: false });
      return true;
    });
    const main = mainProcess('save');
    main.close();
    await vi.waitFor(() => expect(main.result.unloaded).toBe(true));

    expect(readAutosave()).toBeNull();
  });

  it('asks about a copy written after a Save that left the work unsaved', async () => {
    await openUnsavedWindow(async () => true);
    const main = mainProcess('save');
    main.close();
    await vi.waitFor(() => expect(main.result.unloaded).toBe(true));

    expect(startedFreshFrom(writtenCopy())).toBe(false);
  });
});

describe('which unload a desktop close controller calls a discard', () => {
  function harness(dirty = true) {
    let state: DesktopCloseSnapshot = {
      active: false,
      epoch: 1,
      dirty,
      warning: null,
      document: {},
    };
    const controller = new DesktopCloseController(
      () => state,
      async () => undefined,
    );
    return {
      controller,
      patch: (patch: Partial<DesktopCloseSnapshot>) => (state = { ...state, ...patch }),
    };
  }

  it('answers yes once, for the approved unload of unsaved work, in either hook order', async () => {
    const h = harness();
    await h.controller.prepare(1);
    h.controller.approve(1);
    const event = unloadEvent();
    expect(h.controller.unloadDiscardsUnsavedWork(event)).toBe(true);
    expect(h.controller.handleBeforeUnload(event)).toBe(true);
    expect(h.controller.unloadDiscardsUnsavedWork(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    // The approval was for one unload.
    const repeated = unloadEvent();
    expect(h.controller.unloadDiscardsUnsavedWork(repeated)).toBe(false);
    expect(repeated.defaultPrevented).toBe(true);

    const later = harness();
    await later.controller.prepare(1);
    later.controller.approve(1);
    const settledFirst = unloadEvent();
    later.controller.handleBeforeUnload(settledFirst);
    expect(later.controller.unloadDiscardsUnsavedWork(settledFirst)).toBe(true);
  });

  it('answers no for a clean document, an unapproved close and no close at all', async () => {
    const clean = harness(false);
    await clean.controller.prepare(1);
    clean.controller.approve(1);
    expect(clean.controller.unloadDiscardsUnsavedWork(unloadEvent())).toBe(false);

    const unapproved = harness();
    await unapproved.controller.prepare(1);
    const held = unloadEvent();
    expect(unapproved.controller.unloadDiscardsUnsavedWork(held)).toBe(false);
    expect(held.defaultPrevented).toBe(true);

    const browser = unloadEvent();
    expect(harness().controller.unloadDiscardsUnsavedWork(browser)).toBe(false);
    expect(browser.defaultPrevented).toBe(false);
  });

  it('answers no when the work changed after the answer, and holds the window', async () => {
    const h = harness();
    await h.controller.prepare(1);
    h.controller.approve(1);
    h.patch({ document: {} });
    const event = unloadEvent();
    expect(h.controller.unloadDiscardsUnsavedWork(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('answers no for an approval that followed a Save request', async () => {
    const h = harness();
    await h.controller.prepare(1);
    expect(await h.controller.save(1, async () => true)).toEqual({ status: 'saved' });
    expect(h.controller.approve(1)).toEqual({ status: 'approved' });
    const event = unloadEvent();
    expect(h.controller.unloadDiscardsUnsavedWork(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});
