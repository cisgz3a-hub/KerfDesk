// Save G-code from the click to the file dialog (annoyance audit A4-P2-4 and
// A1-P3-9, ADR-656 Amendment 4): one action when the export is ready in time,
// the dialog only when it is slow, and a refusal shown once.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import {
  CHROMIUM_ACTIVATION_LIFESPAN_MS,
  installTransientActivation,
} from '../../platform/web/chromium-save-picker.test-support';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { EXPORT_REFUSAL_TOAST_KEY } from './export-refusal';
import { GcodeSaveDialog } from './GcodeSaveDialog';
import { useGcodeSaveFlowStore, type GcodeSaveFlow } from './gcode-save-flow';
import {
  currentGcodeSaveFlow as flow,
  gcodeSaveHarness as harness,
} from './gcode-save-flow.test-support';
import { PREPARING_DIALOG_DELAY_MS } from './pick-prepared-save-target';
import { currentSaveGcodeContext } from './save-gcode-context';
import * as transactional from './transactional-gcode-save';
import type { GcodeSavePrebuild } from './transactional-gcode-save';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NO_OUTPUT = 'No output layers. Enable Output on at least one layer.';
const actualPrebuild = transactional.prebuildGcodeSaveResult;

let activation: ReturnType<typeof installTransientActivation>;
let kinds: GcodeSaveFlow['kind'][];
let unsubscribe: () => void;
let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  activation = installTransientActivation();
  kinds = [];
  unsubscribe = useGcodeSaveFlowStore.subscribe((state) => {
    if (state.flow !== null) kinds.push(state.flow.kind);
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  unsubscribe();
  activation.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useGcodeSaveFlowStore.setState({ flow: null });
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
});

/** A preparation that finishes only when the test says so. */
function heldPreparation(): {
  readonly finish: (result: GcodeSavePrebuild) => void;
  readonly fail: (error: Error) => void;
  readonly executions: NonNullable<Parameters<typeof actualPrebuild>[1]>[];
} {
  let finish: (result: GcodeSavePrebuild) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const executions: NonNullable<Parameters<typeof actualPrebuild>[1]>[] = [];
  vi.spyOn(transactional, 'prebuildGcodeSaveResult').mockImplementation((_ctx, execution = {}) => {
    executions.push(execution);
    return new Promise<GcodeSavePrebuild>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  });
  return { finish: (result) => finish(result), fail: (error) => fail(error), executions };
}

/** The real export of the open project, built ahead of the fake clock with the
 * context the save itself compiles with. */
async function realExport(): Promise<GcodeSavePrebuild> {
  const result = await actualPrebuild(
    currentSaveGcodeContext({
      platform: { id: 'mock' } as PlatformAdapter,
      app: useStore.getState(),
      laser: useLaserStore.getState(),
      pushToast: vi.fn(),
    }),
  );
  if (result.kind !== 'ready') throw new Error('expected a ready export');
  return result;
}

const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

async function renderDialog(): Promise<HTMLDivElement> {
  const element = document.createElement('div');
  document.body.appendChild(element);
  host = element;
  await act(async () => {
    root = createRoot(element);
    root.render(<GcodeSaveDialog />);
  });
  return element;
}

function button(element: HTMLElement, name: string): HTMLButtonElement {
  const found = [...element.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(name),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${name} button missing`);
  return found;
}

describe.each(['web', 'electron'] as const)('%s Save G-code in one action', (platformId) => {
  it('opens the file dialog straight from the request, with no dialog of its own', async () => {
    const save = harness(projectWithLine(), platformId);

    save.start();
    await vi.waitFor(() => expect(save.write).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(flow()).toBeNull());

    expect(save.pickFileForSave).toHaveBeenCalledOnce();
    expect(save.pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'untitled.gcode',
      extensions: ['.gcode', '.nc'],
    });
    expect(save.written[0]).toContain('G21');
    // Never a state the dialog draws.
    expect(new Set(kinds)).toEqual(new Set(['working']));
  });

  it('writes the same bytes the two-step dialog wrote', async () => {
    const save = harness(projectWithLine(), platformId);
    const expected = await realExport();
    if (expected.kind !== 'ready') throw new Error('expected a ready export');

    save.start();
    await vi.waitFor(() => expect(save.write).toHaveBeenCalledOnce());

    expect(withoutTimestamp(save.written[0] ?? '')).toBe(
      withoutTimestamp(expected.artifact.prepared.gcode),
    );
  });
});

// The provenance header carries the build time of the export.
function withoutTimestamp(gcode: string): string {
  return gcode.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<time>');
}

describe('Save G-code that takes a while', () => {
  it('shows nothing until the delay, then the preparing dialog with Cancel', async () => {
    const save = harness(projectWithLine());
    vi.useFakeTimers();
    heldPreparation();

    save.start();
    await vi.advanceTimersByTimeAsync(PREPARING_DIALOG_DELAY_MS - 1);
    expect(flow()?.kind).toBe('working');
    const element = await renderDialog();
    expect(element.textContent).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(flow()?.kind).toBe('preparing');
    expect(element.textContent).toContain('Preparing your G-code file…');
    expect(button(element, 'Cancel').disabled).toBe(false);
    expect(button(element, 'Save as…').disabled).toBe(true);
    expect(save.pickFileForSave).not.toHaveBeenCalled();
  });

  it.each([
    { readyAtMs: CHROMIUM_ACTIVATION_LIFESPAN_MS - 1, outcome: 'opens the file dialog itself' },
    { readyAtMs: CHROMIUM_ACTIVATION_LIFESPAN_MS, outcome: 'asks for a click on Save as…' },
  ])('ready $readyAtMs ms after the request $outcome', async ({ readyAtMs }) => {
    const save = harness(projectWithLine());
    const ready = await realExport();
    vi.useFakeTimers();
    activation.gesture();
    const preparation = heldPreparation();

    save.start();
    await vi.advanceTimersByTimeAsync(readyAtMs);
    preparation.finish(ready);
    await settle();

    if (readyAtMs < CHROMIUM_ACTIVATION_LIFESPAN_MS) {
      expect(save.pickFileForSave).toHaveBeenCalledOnce();
      expect(save.write).toHaveBeenCalledOnce();
      expect(kinds).toEqual(['working', 'preparing', 'choosing']);
      expect(flow()).toBeNull();
      return;
    }
    expect(flow()?.kind).toBe('ready');
    expect(save.pickFileForSave).not.toHaveBeenCalled();
    const element = await renderDialog();
    expect(element.textContent).toContain('complete export is ready');
    // The fresh click is the activation the picker needs.
    activation.gesture();
    await act(async () => {
      button(element, 'Save as…').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
    });
    expect(save.pickFileForSave).toHaveBeenCalledOnce();
    expect(save.write).toHaveBeenCalledOnce();
    expect(flow()).toBeNull();
  });

  it('shows the progress the preparation reports', async () => {
    const save = harness(projectWithLine());
    vi.useFakeTimers();
    const preparation = heldPreparation();
    const progress = {
      phase: 'planning',
      mode: 'parallel',
      completed: 3,
      active: 2,
      queued: 7,
      total: 12,
    } as const;

    save.start();
    // Progress alone does not bring the dialog forward early.
    preparation.executions[0]?.onProgress?.(progress);
    expect(flow()?.kind).toBe('working');
    await vi.advanceTimersByTimeAsync(PREPARING_DIALOG_DELAY_MS);
    const element = await renderDialog();
    expect(element.textContent).toContain('Planning toolpaths: 3 of 12');

    await act(async () => {
      preparation.executions[0]?.onProgress?.({ ...progress, completed: 9 });
    });
    expect(element.textContent).toContain('Planning toolpaths: 9 of 12');
    expect(element.querySelector('progress')?.getAttribute('value')).toBe('9');
  });

  it('Cancel stops the preparation and nothing is chosen or written', async () => {
    const save = harness(projectWithLine());
    const ready = await realExport();
    vi.useFakeTimers();
    const preparation = heldPreparation();

    save.start();
    await vi.advanceTimersByTimeAsync(PREPARING_DIALOG_DELAY_MS);
    const element = await renderDialog();
    await act(async () => {
      button(element, 'Cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(preparation.executions[0]?.signal?.aborted).toBe(true);
    expect(flow()).toBeNull();
    expect(element.textContent).toBe('');
    preparation.finish(ready);
    await settle();
    expect(flow()).toBeNull();
    expect(save.pickFileForSave).not.toHaveBeenCalled();
    expect(save.pushToast).not.toHaveBeenCalled();
  });

  it('ignores a second request while one is under way', async () => {
    const save = harness(projectWithLine());
    vi.useFakeTimers();
    const preparation = heldPreparation();

    save.start();
    save.start();
    await vi.advanceTimersByTimeAsync(PREPARING_DIALOG_DELAY_MS);
    save.start();

    expect(preparation.executions).toHaveLength(1);
  });
});

describe('a CNC export keeps its dialog', () => {
  it('offers Save as… and the setup sheet package even when it is ready at once', async () => {
    const save = harness({ ...projectWithLine(), machine: DEFAULT_CNC_MACHINE_CONFIG });

    save.start();
    await vi.waitFor(() => expect(flow()?.kind).toBe('ready'));

    expect(save.pickFileForSave).not.toHaveBeenCalled();
    const element = await renderDialog();
    expect(element.textContent).toContain('Save setup sheet + program…');
    expect(button(element, 'Save as…').disabled).toBe(false);
  });
});

describe('a refused Save G-code is shown once', () => {
  it('an empty canvas says so in one error toast, with no dialog and no alert', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const save = harness(createProject());

    save.start();
    await vi.waitFor(() => expect(save.pushToast).toHaveBeenCalled());

    expect(save.pushToast).toHaveBeenCalledOnce();
    expect(save.pushToast).toHaveBeenCalledWith(`Cannot save G-code: ${NO_OUTPUT}`, 'error', {
      key: EXPORT_REFUSAL_TOAST_KEY,
      details: [],
    });
    expect(alert).not.toHaveBeenCalled();
    expect(save.pickFileForSave).not.toHaveBeenCalled();
    expect(new Set(kinds)).toEqual(new Set(['working']));
    expect(flow()).toBeNull();
  });

  it('a refusal while the dialog is open is listed inside it, with one Close', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const save = harness(projectWithLine());
    vi.useFakeTimers();
    const preparation = heldPreparation();

    save.start();
    await vi.advanceTimersByTimeAsync(PREPARING_DIALOG_DELAY_MS);
    const element = await renderDialog();
    await act(async () => {
      preparation.finish({ kind: 'refused', reasons: ['First reason.', 'Second reason.'] });
      await settle();
    });

    expect(flow()?.kind).toBe('refused');
    expect(element.textContent).toContain('Cannot save G-code:');
    expect([...element.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'First reason.',
      'Second reason.',
    ]);
    expect(element.textContent).toContain('No file was created or changed.');
    expect([...element.querySelectorAll('button')].map((item) => item.textContent)).toEqual([
      'Close',
    ]);
    expect(save.pushToast).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();

    await act(async () => {
      button(element, 'Close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(flow()).toBeNull();
    expect(element.textContent).toBe('');
    expect(save.pickFileForSave).not.toHaveBeenCalled();
  });

  it('a preparation that throws is a refusal, not a second popup', async () => {
    const save = harness(projectWithLine());
    vi.useFakeTimers();
    const preparation = heldPreparation();

    save.start();
    preparation.fail(new Error('worker lost'));
    await settle();

    expect(save.pushToast).toHaveBeenCalledOnce();
    expect(save.pushToast).toHaveBeenCalledWith(
      'Cannot save G-code: Preparation failed: worker lost',
      'error',
      { key: EXPORT_REFUSAL_TOAST_KEY, details: [] },
    );
    expect(flow()).toBeNull();
  });
});
