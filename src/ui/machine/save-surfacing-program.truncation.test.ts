// Audit 19-P2-1 / ADR-656: Chromium empties the chosen file as its save picker
// returns, so a surfacing save over last week's program must finish preflight
// and generation before the picker opens. These run the real web adapter
// against a picker modelled on Chromium.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import {
  installChromiumSavePicker,
  lapseUserActivation,
  type ChromiumSavePicker,
} from '../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../platform/web/web-adapter';
import { useSaveReadyDialogStore } from '../state/save-ready-dialog-store';
import { saveSurfacingProgram } from './save-surfacing-program';
import type { SurfacingStreamTask } from './surfacing-worker-client';
import { prepareSurfacingStream } from './surfacing-worker-runtime';
import type { SurfacingWorkerInput } from './surfacing-worker-protocol';

const worker = vi.hoisted(() => ({
  start: vi.fn<(input: SurfacingWorkerInput, signal: AbortSignal) => SurfacingStreamTask>(),
}));
vi.mock('./surfacing-worker-client', () => ({ startSurfacingStream: worker.start }));

const NO_CHUNKS: AsyncIterable<string> = {
  async *[Symbol.asyncIterator]() {
    // Preparation never gets this far.
  },
};

const PREVIOUS = 'G21\nG90\n(previous good surfacing program)\n';

let picker: ChromiumSavePicker | null = null;
let restoreActivation: (() => void) | null = null;
afterEach(() => {
  picker?.restore();
  picker = null;
  restoreActivation?.();
  restoreActivation = null;
  useSaveReadyDialogStore.setState({ request: null });
  worker.start.mockReset();
});

/** Real generation and preflight, optionally failing after `failAfter` chunks. */
function realTask(input: SurfacingWorkerInput, signal: AbortSignal, failAfter?: number) {
  const session = prepareSurfacingStream(input);
  return {
    ready: Promise.resolve(session.prepared),
    chunks: {
      async *[Symbol.asyncIterator]() {
        let sent = 0;
        for (let next = session.chunks.next(); !next.done; next = session.chunks.next()) {
          signal.throwIfAborted();
          if (sent === failAfter) throw new Error('Background surfacing generation failed.');
          sent += 1;
          yield next.value;
        }
      },
    },
    dispose: () => undefined,
  };
}

function save(signal: AbortSignal = new AbortController().signal) {
  const phases: string[] = [];
  const done = saveSurfacingProgram({
    platform: webAdapter,
    pushToast: () => undefined,
    project: { ...createProject(DEFAULT_DEVICE_PROFILE), machine: DEFAULT_CNC_MACHINE_CONFIG },
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    controllerSettings: null,
    settingsCapability: 'none',
    inputs: { widthMm: 100, heightMm: 80, stepoverPct: 40, totalDepthMm: 0.5 },
    signal,
    onChoosing: () => phases.push('choosing'),
    onFinalizing: () => phases.push('finalizing'),
    isCurrent: () => true,
  });
  return { done, phases };
}

describe('surfacing save over an existing file', () => {
  it('keeps the old program when the background preflight refuses, without a picker', async () => {
    const disk = new Map([['surfacing.nc', PREVIOUS]]);
    picker = installChromiumSavePicker(disk);
    worker.start.mockImplementation(() => ({
      ready: Promise.reject(new Error('The surfacing area leaves the machine bed.')),
      chunks: NO_CHUNKS,
      dispose: () => undefined,
    }));

    await expect(save().done).rejects.toThrow('leaves the machine bed');

    expect(picker.picks()).toBe(0);
    expect(disk.get('surfacing.nc')).toBe(PREVIOUS);
  });

  it('keeps the old program when Cancel surfacing save stops preparation', async () => {
    const disk = new Map([['surfacing.nc', PREVIOUS]]);
    picker = installChromiumSavePicker(disk);
    worker.start.mockImplementation((_input, signal) => ({
      ready: new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Surfacing save cancelled.', 'AbortError')),
          { once: true },
        ),
      ),
      chunks: NO_CHUNKS,
      dispose: () => undefined,
    }));
    const controller = new AbortController();

    const { done } = save(controller.signal);
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });

    expect(picker.picks()).toBe(0);
    expect(disk.get('surfacing.nc')).toBe(PREVIOUS);
  });

  it('keeps the old program when generation fails part way', async () => {
    const disk = new Map([['surfacing.nc', PREVIOUS]]);
    picker = installChromiumSavePicker(disk);
    worker.start.mockImplementation((input, signal) => realTask(input, signal, 1));

    await expect(save().done).rejects.toThrow('generation failed');

    expect(picker.picks()).toBe(0);
    expect(disk.get('surfacing.nc')).toBe(PREVIOUS);
  });

  it('keeps the old program when the ready dialog is cancelled', async () => {
    const disk = new Map([['surfacing.nc', PREVIOUS]]);
    picker = installChromiumSavePicker(disk);
    restoreActivation = lapseUserActivation();
    worker.start.mockImplementation((input, signal) => realTask(input, signal));

    const { done } = save();
    await vi.waitFor(() =>
      expect(useSaveReadyDialogStore.getState().request?.title).toBe('Save surfacing program'),
    );
    useSaveReadyDialogStore.getState().request?.cancel();
    await done;

    expect(picker.picks()).toBe(0);
    expect(disk.get('surfacing.nc')).toBe(PREVIOUS);
  });

  it('writes the complete program once the destination is chosen', async () => {
    const disk = new Map([['surfacing.nc', PREVIOUS]]);
    picker = installChromiumSavePicker(disk);
    worker.start.mockImplementation((input, signal) => realTask(input, signal));

    const { done, phases } = save();
    await done;

    expect(picker.picks()).toBe(1);
    expect(phases).toEqual(['choosing', 'finalizing']);
    const written = disk.get('surfacing.nc') ?? '';
    expect(written).not.toBe(PREVIOUS);
    expect(written).toContain('M3 S');
    expect(written).toContain('M5');
  });
});
