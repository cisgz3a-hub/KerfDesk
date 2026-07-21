// Save G-code preflight policy (rule 7 / ADR-228): the scan-offset magnitude
// cap is a heuristic — it must warn on Save exactly as Job Review warns on
// Start, never refuse the export. Non-finite offsets stay blocking (compile
// integrity). Split from file-actions.test.ts for the file-size cap.

import { describe, expect, it, vi } from 'vitest';

import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { FileHandle, PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveGcode } from './file-actions';

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

function projectWithOverCapScanOffset(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [
        {
          // Default 400 mm bed → magnitude limit ±4 mm, so 4.01 is over-cap
          // but finite (advisory, not integrity).
          ...createLayer({ id: '#000000', color: '#000000', mode: 'line' }),
          bidirectionalScanOffsetMm: 4.01,
        },
      ],
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

describe('handleSaveGcode preflight advisory policy', () => {
  it('saves G-code with a warning toast when a finite scan offset exceeds the cap', async () => {
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: 'offset.gcode',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text G-code');
        written.push(data);
      },
    };
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);
    const messages: Array<{ readonly message: string; readonly variant?: string }> = [];

    await handleSaveGcode({
      platform: mockPlatform({ save: async () => target }),
      project: projectWithOverCapScanOffset(),
      savedName: null,
      pushToast: (message, variant) => {
        messages.push(variant === undefined ? { message } : { message, variant });
      },
    });

    expect(alert).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    expect(
      messages.some(
        (m) => m.variant === 'warning' && m.message.includes('scan offset 4.01 mm exceeds'),
      ),
    ).toBe(true);
    vi.restoreAllMocks();
  });
});
