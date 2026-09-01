import { describe, expect, it, vi } from 'vitest';

import {
  mockPlatform,
  projectOpenRequestEpochCallbacks,
  projectSaveRequestEpochCallbacks,
  projectWithLine,
  projectWithTwoLines,
  reject,
  selectedScope,
  toasts,
} from '../../__fixtures__/file-actions';
import { createProject, type Project } from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from './file-actions';
import { AUTOSAVE_FILE_CLEANUP_WARNING } from './autosave-file-cleanup';

function saveOwner(project: Project) {
  return {
    expectedProject: project,
    projectDocumentEpoch: 0,
    getProjectDocumentEpoch: () => 0,
    ...projectSaveRequestEpochCallbacks(),
  };
}

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
        () => 0,
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
        ...projectOpenRequestEpochCallbacks(),
        getProjectDocumentEpoch: () => 0,
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
        ...projectOpenRequestEpochCallbacks(),
        getProjectDocumentEpoch: () => 0,
      }),
    ).resolves.toBeUndefined();

    expect(toast.messages).toEqual([
      { message: 'Could not open broken.lf2: read revoked', variant: 'error' },
    ]);
  });

  it('handles project save picker failures with save-specific toast copy', async () => {
    const toast = toasts();
    const project = createProject();

    await expect(
      handleSaveProject({
        platform: mockPlatform({ save: () => reject('save picker failed') }),
        project,
        ...saveOwner(project),
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

    await handleImportSvg(
      platform,
      () => ({ kind: 'added' }),
      toast.pushToast,
      () => 0,
    );
    await handleOpenProject({
      platform,
      setProject: vi.fn(() => ({ kind: 'loaded' as const })),
      markLoaded: vi.fn(),
      pushToast: toast.pushToast,
      ...projectOpenRequestEpochCallbacks(),
      getProjectDocumentEpoch: () => 0,
    });
    const project = projectWithLine();
    await expect(
      handleSaveProject({
        platform,
        project,
        ...saveOwner(project),
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
    const markSaved = vi.fn(() => true);
    const toast = toasts();
    const project = projectWithLine();

    await expect(
      handleSaveProject({
        platform: mockPlatform({ save: async () => ({ displayName: 'badge.lf2', write }) }),
        project,
        ...saveOwner(project),
        savedName: null,
        lastSaveTarget: null,
        markSaved,
        pushToast: toast.pushToast,
      }),
    ).resolves.toBe('saved');

    expect(write).toHaveBeenCalledTimes(1);
    expect(markSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps a completed save successful when recovery cleanup storage is blocked', async () => {
    const write = vi.fn(async () => undefined);
    const markSaved = vi.fn(() => true);
    const toast = toasts();
    const project = projectWithLine();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('storage blocked', 'SecurityError');
      },
    });
    try {
      await expect(
        handleSaveProject({
          platform: mockPlatform({ save: async () => ({ displayName: 'safe.lf2', write }) }),
          project,
          ...saveOwner(project),
          savedName: null,
          lastSaveTarget: null,
          markSaved,
          pushToast: toast.pushToast,
        }),
      ).resolves.toBe('saved');
      await vi.waitFor(() => {
        expect(toast.messages.at(-1)).toEqual({
          message: AUTOSAVE_FILE_CLEANUP_WARNING,
          variant: 'warning',
        });
      });
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }

    expect(write).toHaveBeenCalledOnce();
    expect(markSaved).toHaveBeenCalledOnce();
    expect(toast.messages.some((entry) => entry.variant === 'error')).toBe(false);
  });

  it('reports error when the write itself fails', async () => {
    const toast = toasts();
    const project = projectWithLine();

    await expect(
      handleSaveProject({
        platform: mockPlatform({
          save: async () => ({ displayName: 'badge.lf2', write: () => reject('disk full') }),
        }),
        project,
        ...saveOwner(project),
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
