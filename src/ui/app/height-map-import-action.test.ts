import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { prepareDepthMapPngOffThread } from '../import/import-worker-client';
import { importHeightMapFiles } from './height-map-import-action';

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
