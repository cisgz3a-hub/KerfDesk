import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { createStreamer, step } from '../../core/controllers/grbl';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { useLaserStore } from '../state/laser-store';
import type { ImportOutcome } from '../state/store';
import { handleFileShortcut, type FileCtx } from './shortcuts';

function contextForFileShortcut(platform: PlatformAdapter): FileCtx {
  return {
    platform,
    project: projectWithLine(),
    importSvgObject: vi.fn((): ImportOutcome => ({ kind: 'added' })),
    setProject: vi.fn(() => ({ kind: 'loaded' as const })),
    newProject: vi.fn(),
    savedName: null,
    jobPlacement: DEFAULT_JOB_PLACEMENT,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    machine: { statusReport: null, workOriginActive: false, wcoCache: null },
    controllerSettings: null,
    settingsCapability: 'grbl-dollar',
    lastSaveTarget: null,
    markSaved: vi.fn(),
    markLoaded: vi.fn(),
    pushToast: vi.fn(),
    confirmDiscard: vi.fn(async () => true),
  };
}

describe('File shortcuts while a job is active', () => {
  beforeEach(() => {
    useLaserStore.setState({
      streamer: step(createStreamer('G1 X1 S100')).state,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
  });

  afterEach(() => {
    useLaserStore.setState({ streamer: null } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
  });

  it.each([
    ['New', { key: 'n', ctrlKey: true }, 'confirm'],
    ['Open', { key: 'o', ctrlKey: true }, 'open'],
    ['Save', { key: 's', ctrlKey: true }, 'save'],
    ['Save As', { key: 's', ctrlKey: true, shiftKey: true }, 'save'],
    ['Import SVG', { key: 'i', ctrlKey: true }, 'open'],
    ['Save G-code', { key: 'e', ctrlKey: true, shiftKey: true }, 'save'],
  ] as const)(
    'keeps %s available without an active-job refusal',
    async (_label, init, expectedEffect) => {
      const pickFilesForOpen = vi.fn(async () => []);
      const pickFileForSave = vi.fn(async () => null);
      const platform: PlatformAdapter = {
        id: 'mock',
        pickFilesForOpen,
        pickFileForSave,
        serial: { isSupported: () => false, requestPort: async () => null },
      };
      const context = contextForFileShortcut(platform);
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });

      expect(handleFileShortcut(event, context)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(context.pushToast).not.toHaveBeenCalledWith(
        expect.stringContaining('job is running'),
        expect.anything(),
      );
      if (expectedEffect === 'confirm') {
        expect(context.confirmDiscard).toHaveBeenCalled();
      } else if (expectedEffect === 'open') {
        await vi.waitFor(() => expect(pickFilesForOpen).toHaveBeenCalled());
      } else {
        await vi.waitFor(() => expect(pickFileForSave).toHaveBeenCalled());
      }
    },
  );
});
