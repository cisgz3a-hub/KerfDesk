import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockPlatform,
  projectWithLine,
  projectWithTwoLines,
  reject,
  SAVE_PREPARATION_FAILURE_CASES,
  SAVE_TARGET_NAME,
  selectedScope,
  toasts,
} from '../../__fixtures__/file-actions';
import { rotaryRasterSaveProject } from '../../__fixtures__/rotary-raster-save-project';
import { createProject } from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from './file-actions';

describe('file actions contextual failure handling', () => {
  it('keeps a no-dump controller readiness advisory non-blocking', async () => {
    const toast = toasts();
    const pickFileForSave = vi.fn(async () => null);
    await handleSaveGcode({
      platform: mockPlatform({ save: pickFileForSave }),
      project: projectWithLine(),
      savedName: null,
      controllerSettings: null,
      settingsCapability: 'none',
      pushToast: toast.pushToast,
    });
    expect(pickFileForSave).toHaveBeenCalledOnce();
    expect(toast.messages).toContainEqual(expect.objectContaining({ variant: 'warning' }));
  });

  it('handles import picker failures with import-specific toast copy', async () => {
    const toast = toasts();

    await expect(
      handleImportSvg(
        mockPlatform({ open: () => reject('permission lost') }),
        () => ({ kind: 'added' }),
        toast.pushToast,
      ),
    ).resolves.toBeUndefined();

    expect(toast.messages).toEqual([
      { message: 'Could not import SVG: permission lost', variant: 'error' },
    ]);
  });

  it('handles project open picker failures with open-specific toast copy', async () => {
    const toast = toasts();

    await expect(
      handleOpenProject({
        platform: mockPlatform({ open: () => reject('picker failed') }),
        setProject: vi.fn(() => ({ kind: 'loaded' as const })),
        markLoaded: vi.fn(),
        pushToast: toast.pushToast,
      }),
    ).resolves.toBeUndefined();

    expect(toast.messages).toEqual([
      { message: 'Could not open project: picker failed', variant: 'error' },
    ]);
  });

  it('handles project file read failures with filename-specific open copy', async () => {
    const toast = toasts();

    await expect(
      handleOpenProject({
        platform: mockPlatform({
          open: async () => [{ name: 'broken.lf2', text: () => reject('read revoked') }],
        }),
        setProject: vi.fn(() => ({ kind: 'loaded' as const })),
        markLoaded: vi.fn(),
        pushToast: toast.pushToast,
      }),
    ).resolves.toBeUndefined();

    expect(toast.messages).toEqual([
      { message: 'Could not open broken.lf2: read revoked', variant: 'error' },
    ]);
  });

  it('handles project save picker failures with save-specific toast copy', async () => {
    const toast = toasts();

    await expect(
      handleSaveProject({
        platform: mockPlatform({ save: () => reject('save picker failed') }),
        project: createProject(),
        savedName: null,
        lastSaveTarget: null,
        markSaved: vi.fn(),
        pushToast: toast.pushToast,
      }),
    ).resolves.toBe('error');

    expect(toast.messages).toEqual([
      { message: 'Could not save project: save picker failed', variant: 'error' },
    ]);
  });

  it('handles G-code save picker failures with save-specific toast copy', async () => {
    const toast = toasts();

    await expect(
      handleSaveGcode({
        platform: mockPlatform({ save: () => reject('export picker failed') }),
        project: projectWithLine(),
        savedName: null,
        pushToast: toast.pushToast,
      }),
    ).resolves.toBeUndefined();

    expect(toast.messages).toEqual([
      { message: 'Could not save G-code: export picker failed', variant: 'error' },
    ]);
  });

  // M11 (AUDIT-2026-06-10) added a confirm here: a project max S of 1000 saved
  // for a $30=255 machine clamps every S>255 to 100% beam power from the saved
  // file. The hazard is real, but rule 7 / ADR-228 names "save … export" and
  // "adds confirmation before an otherwise available action" in the guard
  // definition and makes controller-setting policy warn-only — so the export
  // proceeds to the picker unasked, and the $30 mismatch is stated as a
  // post-save warning instead. The exact warning and cancel-path behavior are
  // pinned in file-actions.controller-readiness.test.ts.
  it('reaches the file picker unasked when the connected controller $30 disagrees', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const save = vi.fn(async () => null);
    const toast = toasts();

    await handleSaveGcode({
      platform: mockPlatform({ save }),
      project: projectWithLine(),
      savedName: null,
      controllerSettings: { maxPowerS: 255, laserModeEnabled: true },
      pushToast: toast.pushToast,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('notes the assumed $30 after saving while never connected', async () => {
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: 'out.gcode',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text G-code');
        written.push(data);
      },
    };
    const toast = toasts();

    await handleSaveGcode({
      platform: mockPlatform({ save: async () => target }),
      project: projectWithLine(),
      savedName: null,
      controllerSettings: null,
      pushToast: toast.pushToast,
    });

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('; assumes: GRBL $30=');
    expect(
      toast.messages.some((m) => m.message.includes('not verified against a connected controller')),
    ).toBe(true);
  });

  it('advances variables only after the export write succeeds', async () => {
    const project = projectWithLine();
    const advanceVariablesAfter = vi.fn();
    const toast = toasts();
    await handleSaveGcode({
      platform: mockPlatform({
        save: async () => ({ displayName: 'out.gcode', write: async () => undefined }),
      }),
      project,
      savedName: null,
      advanceVariablesAfter,
      pushToast: toast.pushToast,
    });
    expect(advanceVariablesAfter).toHaveBeenCalledWith(project, 'successful-export');

    advanceVariablesAfter.mockClear();
    await handleSaveGcode({
      platform: mockPlatform({
        save: async () => ({
          displayName: 'failed.gcode',
          write: async () => Promise.reject(new Error('disk full')),
        }),
      }),
      project,
      savedName: null,
      advanceVariablesAfter,
      pushToast: toast.pushToast,
    });
    expect(advanceVariablesAfter).not.toHaveBeenCalled();
  });

  it('saves only selected artwork when Cut Selected Graphics is enabled', async () => {
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: 'selected.gcode',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text G-code');
        written.push(data);
      },
    };
    const toast = toasts();

    await handleSaveGcode({
      platform: mockPlatform({ save: async () => target }),
      project: projectWithTwoLines(),
      savedName: null,
      outputScope: selectedScope(['B']),
      pushToast: toast.pushToast,
    });

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('X120');
    expect(written[0]).not.toContain('X10');
  });

  // H12 (AUDIT-2026-06-10): job-intent warnings (luma upsample, uncalibrated
  // defaults, trace-vector) used to surface only on the streamed Start path —
  // a saved-to-disk export carried no warning at all. Surface them on Save too.
  it('surfaces job intent warnings as warning toasts on the Save G-code path', async () => {
    const target: SaveTarget = { displayName: 'out.gcode', write: async () => undefined };
    const toast = toasts();

    await handleSaveGcode({
      platform: mockPlatform({ save: async () => target }),
      project: projectWithLine(), // a default-params layer trips the uncalibrated warning
      savedName: null,
      pushToast: toast.pushToast,
    });

    expect(
      toast.messages.some((m) => m.variant === 'warning' && m.message.includes('uncalibrated')),
    ).toBe(true);
  });

  it('keeps cancelled open/save pickers silent', async () => {
    const toast = toasts();
    const platform = mockPlatform();

    await handleImportSvg(platform, () => ({ kind: 'added' }), toast.pushToast);
    await handleOpenProject({
      platform,
      setProject: vi.fn(() => ({ kind: 'loaded' as const })),
      markLoaded: vi.fn(),
      pushToast: toast.pushToast,
    });
    await expect(
      handleSaveProject({
        platform,
        project: projectWithLine(),
        savedName: null,
        lastSaveTarget: null,
        markSaved: vi.fn(),
        pushToast: toast.pushToast,
      }),
    ).resolves.toBe('cancelled');
    await handleSaveGcode({
      platform,
      project: projectWithLine(),
      savedName: null,
      pushToast: toast.pushToast,
    });

    expect(toast.messages).toEqual([]);
  });

  // LU18: the Save-before-discard flow branches on this outcome — a
  // cancelled picker must abort the destructive action, not discard.
  it('reports saved after a successful write', async () => {
    const write = vi.fn(async () => undefined);
    const markSaved = vi.fn();
    const toast = toasts();

    await expect(
      handleSaveProject({
        platform: mockPlatform({ save: async () => ({ displayName: 'badge.lf2', write }) }),
        project: projectWithLine(),
        savedName: null,
        lastSaveTarget: null,
        markSaved,
        pushToast: toast.pushToast,
      }),
    ).resolves.toBe('saved');

    expect(write).toHaveBeenCalledTimes(1);
    expect(markSaved).toHaveBeenCalledTimes(1);
  });

  it('reports error when the write itself fails', async () => {
    const toast = toasts();

    await expect(
      handleSaveProject({
        platform: mockPlatform({
          save: async () => ({ displayName: 'badge.lf2', write: () => reject('disk full') }),
        }),
        project: projectWithLine(),
        savedName: null,
        lastSaveTarget: null,
        markSaved: vi.fn(),
        pushToast: toast.pushToast,
      }),
    ).resolves.toBe('error');

    expect(toast.messages).toEqual([
      { message: 'Could not save project: disk full', variant: 'error' },
    ]);
  });
});

describe('handleSaveGcode preparation failures', () => {
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

      expect(pickFileForSave).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(advanceVariablesAfter).not.toHaveBeenCalled();
      expect(notifications.some((toast) => toast.variant === 'success')).toBe(false);
      expect(alert).toHaveBeenCalledOnce();
      expect(alert.mock.calls[0]?.[0]).toContain(message);
    },
  );
});

describe('handleSaveGcode rotary raster emission', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops before picker, write, advancement, and success when Labs permission is absent', async () => {
    const project = rotaryRasterSaveProject();
    const write = vi.fn<SaveTarget['write']>();
    const target: SaveTarget = { displayName: SAVE_TARGET_NAME, write };
    const pickFileForSave = vi.fn(async () => target);
    const advanceVariablesAfter = vi.fn();
    const pushToast = vi.fn();
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

    await handleSaveGcode({
      platform: mockPlatform({ save: pickFileForSave }),
      project,
      savedName: null,
      pushToast,
      advanceVariablesAfter,
    });

    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(advanceVariablesAfter).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('Rotary image engraving is experimental and disabled'),
    );
  });

  it('writes non-empty rotary raster bytes and reports success with explicit permission', async () => {
    const project = rotaryRasterSaveProject();
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: SAVE_TARGET_NAME,
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text G-code');
        written.push(data);
      },
    };
    const pickFileForSave = vi.fn(async () => target);
    const advanceVariablesAfter = vi.fn();
    const pushToast = vi.fn();
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

    await handleSaveGcode({
      platform: mockPlatform({ save: pickFileForSave }),
      project,
      savedName: null,
      allowRotaryRaster: true,
      pushToast,
      advanceVariablesAfter,
    });

    expect(alert).not.toHaveBeenCalled();
    expect(pickFileForSave).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    expect(written[0]).not.toBe('');
    expect(advanceVariablesAfter).toHaveBeenCalledWith(project, 'successful-export');
    expect(pushToast).toHaveBeenCalledWith(`Saved G-code to ${SAVE_TARGET_NAME}`, 'success');
  });
});
