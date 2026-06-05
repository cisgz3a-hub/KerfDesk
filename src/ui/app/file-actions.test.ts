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
    ).resolves.toBeUndefined();

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
    await handleSaveProject({
      platform,
      project: projectWithLine(),
      savedName: null,
      lastSaveTarget: null,
      markSaved: vi.fn(),
      pushToast: toast.pushToast,
    });
    await handleSaveGcode({
      platform,
      project: projectWithLine(),
      savedName: null,
      pushToast: toast.pushToast,
    });

    expect(toast.messages).toEqual([]);
  });
});
