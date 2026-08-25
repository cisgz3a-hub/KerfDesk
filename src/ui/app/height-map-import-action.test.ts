import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTransform,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  type SceneObject,
} from '../../core/scene';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import type { PlatformAdapter } from '../../platform/types';
import { prepareReliefHeightfieldPngOffThread } from '../import/import-worker-client';
import { makePng, streamingBlob, u16beBytes } from '../import/png-incremental-decoder.test-support';
import { applyFreshImport } from '../state/scene-mutations';
import { handleImportHeightMaps, importHeightMapFiles } from './height-map-import-action';

vi.mock('../import/import-worker-client', () => ({
  prepareReliefHeightfieldPngOffThread: vi.fn(),
}));

const PREPARED = {
  kind: 'ok' as const,
  heightfield: testReliefHeightfield({
    width: 4,
    height: 2,
    physicalWidthMm: 100,
    physicalHeightMm: 50,
    maxDepthMm: 5,
    samplesU8: [0, 32, 64, 96, 128, 160, 192, 255],
    provenance: { sourceName: 'depth.png' },
  }),
};

beforeEach(() => {
  vi.mocked(prepareReliefHeightfieldPngOffThread).mockReset();
});

describe('importHeightMapFiles', () => {
  it('creates an aspect-correct durable relief with explicit safe defaults', async () => {
    vi.mocked(prepareReliefHeightfieldPngOffThread).mockResolvedValue(PREPARED);
    const importObject = vi.fn();
    const pushToast = vi.fn();

    await importHeightMapFiles([new File(['png'], 'depth.png', { type: 'image/png' })], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject,
      pushToast,
    });

    expect(prepareReliefHeightfieldPngOffThread).toHaveBeenCalledWith(
      expect.any(File),
      'depth.png',
      100,
      5,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(importObject).toHaveBeenCalledOnce();
    expect(importObject.mock.calls[0]?.[0]).toMatchObject({
      kind: 'relief',
      source: 'depth.png',
      targetWidthMm: 100,
      reliefDepthMm: 5,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      reliefSource: {
        kind: 'heightfield-v1',
        schemaVersion: 1,
        width: 4,
        height: 2,
        physicalWidthMm: 100,
        physicalHeightMm: 50,
        encoding: 'u16le-base64-v1',
        samplesBase64: Buffer.from([
          0, 0, 32, 32, 64, 64, 96, 96, 128, 128, 160, 160, 192, 192, 255, 255,
        ]).toString('base64'),
        mapping: { polarity: 'light-is-high', maxDepthMm: 5, aspect: 'preserve' },
        provenance: {
          sourceKind: 'depth-map',
          sourceName: 'depth.png',
          sourceBitDepth: 8,
          sourcePolarity: 'light-is-high',
        },
      },
    });
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/light is high/i), 'success');
  });

  it('preserves the source aspect ratio in imported relief bounds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 128 }),
        fc.integer({ min: 1, max: 128 }),
        async (width, height) => {
          vi.mocked(prepareReliefHeightfieldPngOffThread).mockResolvedValueOnce({
            kind: 'ok',
            heightfield: testReliefHeightfield({
              width,
              height,
              physicalWidthMm: 100,
              physicalHeightMm: (100 * height) / width,
              maxDepthMm: 5,
              samplesU8: new Array(width * height).fill(128),
              provenance: { sourceName: 'depth.png' },
            }),
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
    vi.mocked(prepareReliefHeightfieldPngOffThread).mockResolvedValue(PREPARED);
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

  it('keeps the reported physical width when a tall map enters the live scene', async () => {
    vi.mocked(prepareReliefHeightfieldPngOffThread).mockResolvedValue({
      kind: 'ok',
      heightfield: testReliefHeightfield({
        width: 1,
        height: 10,
        physicalWidthMm: 100,
        physicalHeightMm: 1000,
        maxDepthMm: 5,
        samplesU8: new Array(10).fill(0),
        provenance: { sourceName: 'tall-depth.png' },
      }),
    });
    let state: Parameters<typeof applyFreshImport>[0] = {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      undoStack: [],
    };

    await importHeightMapFiles([new File(['png'], 'tall-depth.png')], {
      project: state.project,
      importObject: (object, batchIndex) => {
        const result = applyFreshImport(state, object, batchIndex ?? 0);
        state = { project: result.project, undoStack: result.undoStack };
      },
      pushToast: vi.fn(),
    });

    const stored = state.project.scene.objects[0];
    if (stored?.kind !== 'relief') throw new Error('height-map relief missing');
    expect(stored.targetWidthMm * Math.abs(stored.transform.scaleX)).toBe(100);
    expect(stored.transform.scaleX).toBe(1);
    expect(stored.transform.scaleY).toBe(1);
    const center = applyTransform(
      {
        x: (stored.bounds.minX + stored.bounds.maxX) / 2,
        y: (stored.bounds.minY + stored.bounds.maxY) / 2,
      },
      stored.transform,
    );
    expect(center.x).toBe(state.project.device.bedWidth / 2);
    expect(center.y).toBe(state.project.device.bedHeight / 2);
  });

  it('falls back visibly to exact main-thread preparation when a worker cannot start', async () => {
    vi.mocked(prepareReliefHeightfieldPngOffThread).mockReturnValue(null);
    const importObject = vi.fn();
    const pushToast = vi.fn();
    const png = makePng({ width: 2, height: 1, colorType: 0, rows: [[0, 255]] });

    await importHeightMapFiles([streamingFile(png, 'fallback.png')], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject,
      pushToast,
    });

    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/background worker could not start.*main thread/i),
      'warning',
    );
    expect(importObject).toHaveBeenCalledOnce();
    expect(importObject.mock.calls[0]?.[0]).toMatchObject({
      kind: 'relief',
      source: 'fallback.png',
      reliefSource: {
        kind: 'heightfield-v1',
        width: 2,
        height: 1,
        samplesBase64: 'AAD//w==',
      },
    });
  });

  it('preserves exact grayscale-16 codes through the disclosed main-thread fallback', async () => {
    vi.mocked(prepareReliefHeightfieldPngOffThread).mockReturnValue(null);
    const importObject = vi.fn();
    const pushToast = vi.fn();
    const png = makePng({
      width: 4,
      height: 2,
      colorType: 0,
      bitDepth: 16,
      rows: [
        u16beBytes(0x0000, 0x0001, 0x00ff, 0x0100),
        u16beBytes(0x1234, 0x7fff, 0x8000, 0xffff),
      ],
      filters: [1, 4],
      transparency: Uint8Array.of(0x12, 0x34),
    });

    await importHeightMapFiles([streamingFile(png, 'fallback-u16.png')], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject,
      pushToast,
    });

    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/background worker could not start.*main thread/i),
      'warning',
    );
    expect(importObject).toHaveBeenCalledOnce();
    expect(importObject.mock.calls[0]?.[0]).toMatchObject({
      kind: 'relief',
      source: 'fallback-u16.png',
      reliefSource: {
        kind: 'heightfield-v1',
        width: 4,
        height: 2,
        samplesBase64: 'AAABAP8AAAE0Ev9/AID//w==',
        inclusionMask: { encoding: 'u8-base64-v1', samplesBase64: '/////wD///8=' },
        provenance: { sourceBitDepth: 16 },
        digest: 'sha256:c4f8f369dc15354d066ab2411b3a2dbc4e65c16b8ed914e1ca55c733448d8b8a',
      },
    });
  });

  it('preserves exact grayscale-alpha samples and mask through the main-thread fallback', async () => {
    vi.mocked(prepareReliefHeightfieldPngOffThread).mockReturnValue(null);
    const importObject = vi.fn();
    const pushToast = vi.fn();
    const png = makePng({
      width: 4,
      height: 2,
      colorType: 4,
      rows: [
        [0, 0, 1, 1, 127, 127, 255, 128],
        [12, 254, 64, 255, 128, 200, 200, 42],
      ],
      filters: [1, 4],
    });

    await importHeightMapFiles([streamingFile(png, 'fallback-alpha.png')], {
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
      importObject,
      pushToast,
    });

    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/background worker could not start.*main thread/i),
      'warning',
    );
    expect(importObject).toHaveBeenCalledOnce();
    expect(importObject.mock.calls[0]?.[0]).toMatchObject({
      kind: 'relief',
      source: 'fallback-alpha.png',
      reliefSource: {
        kind: 'heightfield-v1',
        width: 4,
        height: 2,
        samplesBase64: 'AAABAX9///8MDEBAgIDIyA==',
        inclusionMask: { encoding: 'u8-base64-v1', samplesBase64: 'AAF/gP7/yCo=' },
        mapping: { inclusionThreshold: 255, outsideMask: 'excluded' },
        provenance: { sourceBitDepth: 8 },
        digest: 'sha256:e4372aace9580e039467c5c6ef5303bcff2febe9d896891a83b43ba73f334b9f',
      },
    });
  });

  it('reports worker cancellation as a warning and leaves the scene unchanged', async () => {
    const cancelled = new Error('cancelled');
    cancelled.name = 'AbortError';
    vi.mocked(prepareReliefHeightfieldPngOffThread).mockRejectedValue(cancelled);
    const importObject = vi.fn();
    const pushToast = vi.fn();

    await importHeightMapFiles([new File(['png'], 'cancelled.png')], {
      project: createProject(),
      importObject,
      pushToast,
    });

    expect(importObject).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('cancelled.png: import cancelled.', 'warning');
  });

  it('reports a worker failure as an error and leaves the scene unchanged', async () => {
    vi.mocked(prepareReliefHeightfieldPngOffThread).mockRejectedValue(
      new Error('worker terminated unexpectedly'),
    );
    const importObject = vi.fn();
    const pushToast = vi.fn();

    await importHeightMapFiles([new File(['png'], 'failed.png')], {
      project: createProject(),
      importObject,
      pushToast,
    });

    expect(importObject).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('failed.png: worker terminated unexpectedly', 'error');
  });
});

function streamingFile(bytes: Uint8Array, name: string): File {
  return {
    ...streamingBlob(bytes),
    name,
    type: 'image/png',
    lastModified: 0,
    webkitRelativePath: '',
  } as File;
}

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
