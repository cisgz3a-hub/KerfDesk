// A large project's Save As from the click to the file dialog (annoyance audit
// A4-P2-4, ADR-656 Amendment 4): validated in time, the picker opens with no
// dialog and no second click; validated too late, the dialog asks for one.
// project-save-large.test.ts covers the slow path's cancel and stale rules.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectSaveTestWorker,
  currentProjectSaveWorker,
} from '../../__fixtures__/project-save-worker';
import { createProject, type Project } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import {
  CHROMIUM_ACTIVATION_LIFESPAN_MS,
  installTransientActivation,
} from '../../platform/web/chromium-save-picker.test-support';
import { useStore } from '../state';
import {
  useProjectSaveDialogStore,
  type ProjectSaveDialogRequest,
} from '../state/project-save-dialog-store';
import { PREPARING_DIALOG_DELAY_MS } from './pick-prepared-save-target';
import { handleSaveProject, type SaveProjectCtx } from './project-save-action';
import { prepareProjectSaveMessage } from './project-save-preparation';
import { projectSaveNeedsWorker } from './project-save-size';

vi.mock('../state/job-aware-dialogs', () => ({ jobAwareConfirm: vi.fn(() => false) }));

function largeProject(): Project {
  return { ...createProject(), notes: 'captured '.repeat(62_500) };
}

function context(pickFileForSave: PlatformAdapter['pickFileForSave']): SaveProjectCtx {
  const state = useStore.getState();
  return {
    platform: {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    },
    project: state.project,
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    markSaved: state.markSaved,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
    savedName: null,
    lastSaveTarget: null,
    pushToast: vi.fn(),
  };
}

const request = (): ProjectSaveDialogRequest | null => useProjectSaveDialogStore.getState().request;

let activation: ReturnType<typeof installTransientActivation>;
let phases: ProjectSaveDialogRequest['phase'][];
let unsubscribe: () => void;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useStore.getState().newProject();
  useStore.setState({ project: largeProject(), dirty: true });
  ProjectSaveTestWorker.instances = [];
  vi.stubGlobal('Worker', ProjectSaveTestWorker);
  vi.useFakeTimers();
  activation = installTransientActivation();
  phases = [];
  unsubscribe = useProjectSaveDialogStore.subscribe((state) => {
    if (state.request !== null) phases.push(state.request.phase);
  });
});

afterEach(() => {
  unsubscribe();
  request()?.cancel();
  activation.restore();
  vi.useRealTimers();
  useStore.getState().newProject();
  vi.unstubAllGlobals();
});

function saveTarget(): { readonly target: SaveTarget; readonly write: ReturnType<typeof vi.fn> } {
  const write = vi.fn(async () => undefined);
  return { target: { displayName: 'large.lf2', write }, write };
}

/** Start a Save As whose validation finishes `readyAtMs` after the click. */
async function saveReadyAfter(readyAtMs: number): Promise<{
  readonly saving: ReturnType<typeof handleSaveProject>;
  readonly pick: ReturnType<typeof vi.fn<PlatformAdapter['pickFileForSave']>>;
  readonly write: ReturnType<typeof vi.fn>;
}> {
  const { target, write } = saveTarget();
  const pick = vi.fn<PlatformAdapter['pickFileForSave']>(async () => target);
  const ctx = context(pick);
  expect(projectSaveNeedsWorker(ctx.project)).toBe(true);
  const saving = handleSaveProject(ctx, true);
  await vi.advanceTimersByTimeAsync(readyAtMs);
  currentProjectSaveWorker().respond(prepareProjectSaveMessage(ctx.project));
  await vi.advanceTimersByTimeAsync(0);
  return { saving, pick, write };
}

describe('large project Save As in one action', () => {
  it('opens the file dialog straight from the click when validated at once, with no dialog', async () => {
    const { saving, pick, write } = await saveReadyAfter(0);

    expect(pick).toHaveBeenCalledExactlyOnceWith({
      suggestedName: 'untitled.lf2',
      extensions: ['.lf2'],
    });
    await expect(saving).resolves.toBe('saved');
    expect(write).toHaveBeenCalledOnce();
    // The Save project dialog was never shown.
    expect(phases).toEqual([]);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('shows nothing until the delay, then the preparing dialog', async () => {
    const pick = vi.fn<PlatformAdapter['pickFileForSave']>(async () => null);
    const saving = handleSaveProject(context(pick), true);

    await vi.advanceTimersByTimeAsync(PREPARING_DIALOG_DELAY_MS - 1);
    expect(request()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(request()?.phase).toBe('preparing');
    expect(pick).not.toHaveBeenCalled();

    request()?.cancel();
    await expect(saving).resolves.toBe('cancelled');
  });

  it.each([
    { readyAtMs: CHROMIUM_ACTIVATION_LIFESPAN_MS - 1, outcome: 'opens the file dialog itself' },
    { readyAtMs: CHROMIUM_ACTIVATION_LIFESPAN_MS, outcome: 'asks for a click on Choose file…' },
  ])('validated $readyAtMs ms after the click $outcome', async ({ readyAtMs }) => {
    const { saving, pick, write } = await saveReadyAfter(readyAtMs);

    if (readyAtMs < CHROMIUM_ACTIVATION_LIFESPAN_MS) {
      expect(pick).toHaveBeenCalledOnce();
      await expect(saving).resolves.toBe('saved');
      // Shown while it prepared, then "Choose a destination in the file dialog."
      expect(phases).toEqual(['preparing', 'choosing']);
      expect(request()).toBeNull();
      return;
    }
    expect(pick).not.toHaveBeenCalled();
    expect(request()?.phase).toBe('ready');
    // The fresh click is the activation the picker needs.
    activation.gesture();
    request()?.choose();
    expect(pick).toHaveBeenCalledOnce();
    await expect(saving).resolves.toBe('saved');
    expect(write).toHaveBeenCalledOnce();
    expect(phases).toEqual(['preparing', 'ready', 'choosing']);
  });

  it('a refused project opens no file dialog and shows no Save project dialog', async () => {
    const bad = {
      ...largeProject(),
      workspace: { ...createProject().workspace, width: Number.NaN },
    };
    useStore.setState({ project: bad });
    const pick = vi.fn<PlatformAdapter['pickFileForSave']>(async () => null);
    const ctx = context(pick);
    const saving = handleSaveProject(ctx, true);
    currentProjectSaveWorker().respond(prepareProjectSaveMessage(ctx.project));

    await expect(saving).resolves.toBe('error');
    expect(pick).not.toHaveBeenCalled();
    expect(phases).toEqual([]);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('a document replaced before validation finishes cancels the save, dialog or not', async () => {
    const pick = vi.fn<PlatformAdapter['pickFileForSave']>(async () => null);
    const ctx = context(pick);
    const saving = handleSaveProject(ctx, true);

    useStore.getState().newProject();
    currentProjectSaveWorker().respond(prepareProjectSaveMessage(ctx.project));

    await expect(saving).resolves.toBe('stale-document');
    expect(pick).not.toHaveBeenCalled();
    expect(phases).toEqual([]);
  });
});
