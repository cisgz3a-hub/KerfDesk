import { describe, expect, it, vi } from 'vitest';

import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { FileHandle, PlatformAdapter, SaveTarget } from '../../platform/types';
import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from './file-actions';

function mockPlatform(
  args: {
    readonly open?: () => Promise<ReadonlyArray<FileHandle>>;
    readonly save?: () => Promise<SaveTarget | null>;
  } = {},
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: args.open ?? (async () => []),
    pickFileForSave: args.save ?? (async () => null),
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

function projectWithLine(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-1',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function reject(message: string): Promise<never> {
  return Promise.reject(new Error(message));
}

function toasts(): {
  readonly pushToast: (message: string, variant?: string) => void;
  readonly messages: ReadonlyArray<{ readonly message: string; readonly variant?: string }>;
} {
  const messages: Array<{ readonly message: string; readonly variant?: string }> = [];
  return {
    pushToast: (message, variant) => {
      messages.push(variant === undefined ? { message } : { message, variant });
    },
    messages,
  };
}

describe('file actions contextual failure handling', () => {
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
        setProject: vi.fn(),
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
        setProject: vi.fn(),
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

  // M11 (AUDIT-2026-06-10): the $30 power-scale check used to protect only
  // the streamed Start path — a project max S of 1000 saved for a $30=255
  // machine clamps every S>255 to 100% beam power from the saved file.
  it('gates the export behind a confirm when the connected controller $30 disagrees', async () => {
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

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain('$30 is 255');
    expect(save).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('saves anyway when the operator confirms the controller mismatch', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const save = vi.fn(async () => null);
    const toast = toasts();

    await handleSaveGcode({
      platform: mockPlatform({ save }),
      project: projectWithLine(),
      savedName: null,
      controllerSettings: { maxPowerS: 255, laserModeEnabled: true },
      pushToast: toast.pushToast,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('notes the assumed $30 after saving while never connected', async () => {
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: 'out.gcode',
      write: async (text: string) => {
        written.push(text);
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

  it('keeps cancelled open/save pickers silent', async () => {
    const toast = toasts();
    const platform = mockPlatform();

    await handleImportSvg(platform, () => ({ kind: 'added' }), toast.pushToast);
    await handleOpenProject({
      platform,
      setProject: vi.fn(),
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
