import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { prepareDepthMapPngOffThread } from '../import/import-worker-client';
import { handleImportHeightMaps, importHeightMapFiles } from './height-map-import-action';

vi.mock('../import/import-worker-client', () => ({
  prepareDepthMapPngOffThread: vi.fn(),
}));

const PREPARED = {
  kind: 'ok' as const,
  depthMap: {
    schemaVersion: 1 as const,
    width: 4,
    height: 2,
    bitDepth: 8 as const,
    samplesBase64: Buffer.from([0, 32, 64, 96, 128, 160, 192, 255]).toString('base64'),
    polarity: 'light-is-high' as const,
  },
};

beforeEach(() => {
  vi.mocked(prepareDepthMapPngOffThread).mockReset();
});

describe('importHeightMapFiles', () => {
  it('creates an aspect-correct durable relief with explicit safe defaults', async () => {
    vi.mocked(prepareDepthMapPngOffThread).mockResolvedValue(PREPARED);
    const importObject = vi.fn();
    const pushToast = vi.fn();

    await importHeightMapFiles([new File(['png'], 'depth.png', { type: 'image/png' })], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject,
      pushToast,
    });

    expect(importObject).toHaveBeenCalledOnce();
    expect(importObject.mock.calls[0]?.[0]).toMatchObject({
      kind: 'relief',
      source: 'depth.png',
      depthMap: PREPARED.depthMap,
      targetWidthMm: 100,
      reliefDepthMm: 5,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    });
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/light is high/i), 'success');
  });

  it('preserves the source aspect ratio in imported relief bounds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 128 }),
        fc.integer({ min: 1, max: 128 }),
        async (width, height) => {
          vi.mocked(prepareDepthMapPngOffThread).mockResolvedValueOnce({
            kind: 'ok',
            depthMap: {
              ...PREPARED.depthMap,
              width,
              height,
            },
          });
          const imported: SceneObject[] = [];
          await importHeightMapFiles([new File(['png'], 'depth.png')], {
            project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
            importObject: (object) => imported.push(object),
            pushToast: vi.fn(),
          });

          const relief = imported[0];
          expect(relief?.kind).toBe('relief');
          if (relief?.kind !== 'relief') return;
          expect(relief.bounds.maxY).toBeCloseTo((100 * height) / width, 10);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('does not block storage in laser mode and discloses that output begins in CNC mode', async () => {
    vi.mocked(prepareDepthMapPngOffThread).mockResolvedValue(PREPARED);
    const importObject = vi.fn();
    const pushToast = vi.fn();

    await importHeightMapFiles([new File(['png'], 'depth.png', { type: 'image/png' })], {
      project: createProject(),
      importObject,
      pushToast,
    });

    expect(importObject).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/becomes output geometry in CNC/i),
      'success',
    );
  });
});

describe('handleImportHeightMaps', () => {
  it('reports a picker failure without leaking an unhandled rejection', async () => {
    const pushToast = vi.fn();
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => {
        throw new Error('picker unavailable');
      },
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    await expect(
      handleImportHeightMaps(platform, {
        project: createProject(),
        importObject: vi.fn(),
        pushToast,
      }),
    ).resolves.toBeUndefined();
    expect(pushToast).toHaveBeenCalledWith(
      'Could not select height maps: picker unavailable',
      'error',
    );
  });
});
