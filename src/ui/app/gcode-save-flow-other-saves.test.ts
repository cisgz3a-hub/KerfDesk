// Save G-code for the saves that never show the Save G-code dialog (a tiled or
// controller-specific file), and the placement the save compiles with
// (ADR-656 Amendment 4, ADR-327). gcode-save-flow.test.tsx covers the dialog.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import type { StatusReport } from '../../core/controllers/grbl';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import * as fileActions from './file-actions';
import {
  EXPORT_PREPARING_TOAST_KEY,
  useGcodeSaveFlowStore,
  type GcodeSaveFlow,
} from './gcode-save-flow';
import {
  currentGcodeSaveFlow as flow,
  gcodeSaveHarness as harness,
} from './gcode-save-flow.test-support';
import { PREPARING_DIALOG_DELAY_MS } from './pick-prepared-save-target';
import * as transactional from './transactional-gcode-save';

let kinds: GcodeSaveFlow['kind'][];
let unsubscribe: () => void;

beforeEach(() => {
  kinds = [];
  unsubscribe = useGcodeSaveFlowStore.subscribe((state) => {
    if (state.flow !== null) kinds.push(state.flow.kind);
  });
});

afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useGcodeSaveFlowStore.setState({ flow: null });
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
});

const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

describe('a controller-specific save needs no dialog in front of it', () => {
  it('a Ruida project goes straight to its .rd file dialog', async () => {
    const base = projectWithLine();
    const save = harness({ ...base, device: { ...base.device, controllerKind: 'ruida' } });

    save.start();
    await vi.waitFor(() => expect(save.write).toHaveBeenCalledOnce(), { timeout: 20_000 });
    await vi.waitFor(() => expect(flow()).toBeNull());

    expect(save.pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'job.rd',
      extensions: ['.rd'],
    });
    expect(new Set(kinds)).toEqual(new Set(['working']));
  });

  it('says it is preparing when its own steps take a while, and clears that when done', async () => {
    const save = harness(projectWithLine());
    vi.useFakeTimers();
    vi.spyOn(transactional, 'prebuildGcodeSaveResult').mockResolvedValue({ kind: 'not-ordinary' });
    let finish: () => void = () => undefined;
    vi.spyOn(fileActions, 'handleSaveGcode').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const dismissToastKey = vi.spyOn(useToastStore.getState(), 'dismissToastKey');

    save.start();
    await vi.advanceTimersByTimeAsync(PREPARING_DIALOG_DELAY_MS - 1);
    expect(save.pushToast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save.pushToast).toHaveBeenCalledExactlyOnceWith('Preparing the export…', 'info', {
      key: EXPORT_PREPARING_TOAST_KEY,
    });
    // Never the Save G-code dialog: these saves show their own folder or file dialog.
    expect(flow()?.kind).toBe('working');

    finish();
    await settle();
    expect(dismissToastKey).toHaveBeenCalledWith(EXPORT_PREPARING_TOAST_KEY);
    expect(flow()).toBeNull();
  });

  it('a save that throws is reported and does not block the next one', async () => {
    const save = harness(projectWithLine());
    vi.useFakeTimers();
    vi.spyOn(transactional, 'prebuildGcodeSaveResult').mockResolvedValue({ kind: 'not-ordinary' });
    vi.spyOn(fileActions, 'handleSaveGcode').mockRejectedValue(new Error('disk gone'));

    save.start();
    await settle();

    expect(save.pushToast).toHaveBeenCalledExactlyOnceWith(
      'Could not save G-code: disk gone',
      'error',
    );
    expect(flow()).toBeNull();
  });
});

describe('G-code save placement units (ADR-327)', () => {
  it('places a Current Position export with the controller report units', async () => {
    // The line fixture spans scene X 0..10 at Y 0 (machine Y 400 on the default
    // 400 mm front-left bed). With the head at WPos (1, 2) INCHES the anchor must
    // land at 25.4 / 50.8 mm — exactly what Preview and Start compile — not at
    // the raw 1 / 2 the save's context used to hand the export resolver.
    const save = harness(projectWithLine());
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    useLaserStore.setState({
      statusReport: {
        state: 'Idle',
        mPos: null,
        wPos: { x: 1, y: 2, z: 0 },
        wco: null,
      } as unknown as StatusReport,
      controllerSettings: { reportInches: true } as ControllerSettingsSnapshot,
    });

    save.start();
    await vi.waitFor(() => expect(save.write).toHaveBeenCalledOnce());

    const text = save.written.join('');
    expect(text).toContain('X25.400');
    expect(text).toContain('Y50.800');
    expect(text).not.toMatch(/X1\.000 Y2\.000/);
  });
});
