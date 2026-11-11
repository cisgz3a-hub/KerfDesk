import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockPlatform,
  SAVE_PREPARATION_FAILURE_CASES,
  SAVE_TARGET_NAME,
  toasts,
} from '../../__fixtures__/file-actions';
import { flowingVCarveProject } from '../../__fixtures__/flowing-vcarve-project';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import type { SaveTarget } from '../../platform/types';
import type * as OutputWorkerModule from '../laser/output-preparation-worker-client';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { handleSaveGcode } from './file-actions';

const outputWorkerMocks = vi.hoisted(() => ({
  prepareSave: vi.fn<typeof OutputWorkerModule.prepareSaveOutputOffThread>(),
}));

vi.mock('../laser/output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  prepareSaveOutputOffThread: outputWorkerMocks.prepareSave,
}));

beforeEach(() => {
  outputWorkerMocks.prepareSave.mockReset().mockImplementation((request, onProgress, signal) =>
    prepareOutputRequestForTest(request, {
      ...(onProgress === undefined ? {} : { onProgress }),
      ...(signal === undefined ? {} : { signal }),
    }).then((response) => {
      if (response.kind !== 'save') throw new Error('Save test adapter returned no file.');
      return response.result;
    }),
  );
});

it('shows the actual compiled flowing V-carve depth after a background save', async () => {
  const target: SaveTarget = { displayName: 'flowing-v.gcode', write: async () => undefined };
  const toast = toasts();

  await handleSaveGcode({
    platform: mockPlatform({ save: async () => target }),
    project: flowingVCarveProject(),
    savedName: null,
    pushToast: toast.pushToast,
  });

  expect(
    toast.messages.some(
      ({ message, variant }) =>
        variant === 'warning' &&
        message.includes('actual compiled V-carve depth') &&
        message.includes('into the spoilboard'),
    ),
  ).toBe(true);
});

describe('background Save preparation failures', () => {
  beforeEach(() => {
    useExperimentalLaserFeatures.getState().resetFeatures();
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
    usePrintCutSessionStore.getState().clear();
  });

  afterEach(() => {
    usePrintCutSessionStore.getState().clear();
    useExperimentalLaserFeatures.getState().resetFeatures();
    vi.restoreAllMocks();
  });

  it.each(SAVE_PREPARATION_FAILURE_CASES)(
    'does not create an empty successful export for $name',
    async ({ project, message }) => {
      const write = vi.fn(async () => undefined);
      const target: SaveTarget = { displayName: SAVE_TARGET_NAME, write };
      const pickFileForSave = vi.fn(async () => target);
      const advanceVariablesAfter = vi.fn();
      const notifications: Array<{ readonly message: string; readonly variant?: string }> = [];
      const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

      await handleSaveGcode({
        platform: mockPlatform({ save: pickFileForSave }),
        project: project(),
        savedName: null,
        advanceVariablesAfter,
        pushToast: (toastMessage, variant) => {
          notifications.push(
            variant === undefined ? { message: toastMessage } : { message: toastMessage, variant },
          );
        },
      });

      expect(write).not.toHaveBeenCalled();
      expect(advanceVariablesAfter).not.toHaveBeenCalled();
      expect(notifications.some((toast) => toast.variant === 'success')).toBe(false);
      // The refusal is one error toast, never a native alert (ADR-656 Amendment 4).
      expect(alert).not.toHaveBeenCalled();
      const refusals = notifications.filter((toast) => toast.variant === 'error');
      expect(refusals).toHaveLength(1);
      expect(refusals[0]?.message).toMatch(/^Cannot save G-code: /);
      expect(refusals[0]?.message).toContain(message);
    },
  );
});
