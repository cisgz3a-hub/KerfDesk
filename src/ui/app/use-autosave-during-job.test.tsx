// Autosave while a job runs, and the status bar's lasting sign (annoyance
// audit A1: A4-P2-1 and A5-P2-1; ADR-305 Amendment 1).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl/streamer';
import {
  addLayer,
  addObject,
  createLayer,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { AUTOSAVE_INTERVAL_MS } from '../state/autosave';
import { projectAutosaveService } from '../state/autosave-durable';
import { useBackgroundSaveHealth } from '../state/background-save-health';
import { useLaserStore } from '../state/laser-store';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  AUTOSAVE_FAILURE_MESSAGE,
  AUTOSAVE_WAITING_FOR_JOB_MESSAGE,
  useAutosave,
} from './use-autosave';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const WRITTEN = {
  kind: 'ok',
  savedAt: 1,
  storageKey: 'autosave-job-test',
  backend: 'indexeddb',
} as const;
const FAILED = { kind: 'failed', reason: 'quota', error: new Error('full') } as const;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function HookProbe(): null {
  useAutosave();
  return null;
}

async function mountHook(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<HookProbe />));
}

async function tick(count = 1): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * count));
}

function setJob(status: 'streaming' | 'paused' | null): void {
  useLaserStore.setState({
    streamer: status === null ? null : { ...createStreamer('G1 X1 S100\nG1 X2 S100\n'), status },
  });
}

/** An edit made on the canvas: a new project value, marked unsaved. */
function draw(id: string): void {
  const state = useStore.getState();
  useStore.setState({
    project: {
      ...state.project,
      scene: addObject(state.project.scene, svgObj(id, ['#000000'])),
    },
    dirty: true,
  });
}

/** Four bed-sized photos: tens of milliseconds for the window to hand over. */
function importPhotos(): void {
  const state = useStore.getState();
  const lumaBase64 = 'A'.repeat(16_000_000);
  const photos = [1, 2, 3, 4].map(
    (index) =>
      ({
        kind: 'raster-image',
        id: `photo-${index}`,
        source: `photo-${index}.png`,
        lumaBase64,
        pixelWidth: 4000,
        pixelHeight: 3000,
        bounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
        transform: IDENTITY_TRANSFORM,
        color: '#808080',
        dither: 'floyd-steinberg',
        linesPerMm: 10,
      }) as SceneObject,
  );
  useStore.setState({
    project: {
      ...state.project,
      scene: { ...state.project.scene, objects: [...state.project.scene.objects, ...photos] },
    },
    dirty: true,
  });
}

function autosaveSign() {
  return useBackgroundSaveHealth.getState().signs.autosave;
}

function warnings(): string[] {
  return useToastStore
    .getState()
    .toasts.filter((toast) => toast.variant === 'warning')
    .map((toast) => toast.message);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  const project = projectWithCurrentJobSetup(useStore.getState());
  const scene = addObject(
    addLayer(project.scene, createLayer({ id: '#000000', color: '#000000' })),
    svgObj('A', ['#000000']),
  );
  useStore.setState({ project: { ...project, scene }, dirty: true });
  vi.spyOn(projectAutosaveService, 'session').mockResolvedValue({
    sessionId: 'autosave-job-test',
    ownership: 'owned',
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  setJob(null);
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  useBackgroundSaveHealth.setState({ signs: {} });
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  resetStore();
});

describe('autosave while a job runs (A4-P2-1)', () => {
  for (const status of ['streaming', 'paused'] as const) {
    it(`keeps a recovery copy of work drawn while the job is ${status}`, async () => {
      const write = vi.spyOn(projectAutosaveService, 'write').mockResolvedValue(WRITTEN);
      await mountHook();
      await tick();
      expect(write).toHaveBeenCalledTimes(1);

      setJob(status);
      draw('drawn-during-the-job');
      await tick();

      expect(write).toHaveBeenCalledTimes(2);
      expect(write.mock.calls[1]?.[0].scene.objects.map((object) => object.id)).toContain(
        'drawn-during-the-job',
      );
      expect(autosaveSign()).toBeUndefined();
    });
  }

  it('writes the first copy of a session during a job too', async () => {
    const write = vi.spyOn(projectAutosaveService, 'write').mockResolvedValue(WRITTEN);
    setJob('streaming');
    await mountHook();
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('holds back a project too heavy to hand over, says so, and writes it when the job ends', async () => {
    const write = vi.spyOn(projectAutosaveService, 'write').mockResolvedValue(WRITTEN);
    await mountHook();
    await tick();
    setJob('streaming');
    importPhotos();

    await tick(2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(autosaveSign()).toEqual({ state: 'waiting', message: AUTOSAVE_WAITING_FOR_JOB_MESSAGE });
    // The sign is the whole disclosure: no toast for a job doing its work.
    expect(warnings()).toEqual([]);

    setJob(null);
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
    expect(autosaveSign()).toBeUndefined();
  });

  it('drops the waiting sign when the project is saved to a file during the job', async () => {
    vi.spyOn(projectAutosaveService, 'write').mockResolvedValue(WRITTEN);
    await mountHook();
    setJob('streaming');
    importPhotos();
    await tick();
    expect(autosaveSign()?.state).toBe('waiting');

    act(() => useStore.setState({ dirty: false }));
    expect(autosaveSign()).toBeUndefined();
    await tick();
    expect(autosaveSign()).toBeUndefined();
  });

  it('waits for the job to end once a write falls back to localStorage', async () => {
    const write = vi
      .spyOn(projectAutosaveService, 'write')
      .mockResolvedValue({ ...WRITTEN, backend: 'local' });
    await mountHook();
    await tick();
    expect(write).toHaveBeenCalledTimes(1);

    // That fallback serialises the whole project on the canvas thread.
    setJob('streaming');
    draw('during-the-job');
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
    expect(autosaveSign()?.state).toBe('waiting');

    setJob(null);
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
    expect(autosaveSign()).toBeUndefined();
  });
});

describe('the lasting sign of a failed autosave (A5-P2-1)', () => {
  it('stays after the one toast, through later failures, until a write succeeds', async () => {
    const write = vi.spyOn(projectAutosaveService, 'write').mockResolvedValue(FAILED);
    await mountHook();
    await tick();
    expect(warnings()).toEqual([AUTOSAVE_FAILURE_MESSAGE]);
    expect(autosaveSign()).toEqual({ state: 'failed', message: AUTOSAVE_FAILURE_MESSAGE });

    // The toast leaves; the sign does not.
    act(() => {
      for (const toast of useToastStore.getState().toasts) {
        useToastStore.getState().dismissToast(toast.id);
      }
    });
    draw('second-attempt');
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
    expect(warnings()).toEqual([]);
    expect(autosaveSign()?.state).toBe('failed');

    write.mockResolvedValue(WRITTEN);
    draw('third-attempt');
    await tick();
    expect(autosaveSign()).toBeUndefined();
  });

  it('stays a failure, not a wait, when a job then holds the retry back', async () => {
    vi.spyOn(projectAutosaveService, 'write').mockResolvedValue(FAILED);
    await mountHook();
    await tick();
    setJob('streaming');
    draw('during-the-job');
    await tick();
    expect(autosaveSign()).toEqual({ state: 'failed', message: AUTOSAVE_FAILURE_MESSAGE });
  });

  it('goes when the project is saved to a file', async () => {
    vi.spyOn(projectAutosaveService, 'write').mockResolvedValue(FAILED);
    await mountHook();
    await tick();
    expect(autosaveSign()?.state).toBe('failed');

    act(() => useStore.setState({ dirty: false }));
    expect(autosaveSign()).toBeUndefined();
  });
});
