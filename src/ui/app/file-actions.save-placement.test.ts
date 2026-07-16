// Save G-code placement gate (export-time, not start-time). The exported
// file's coordinates never depend on the live machine origin for user-origin
// / verified-origin placements: the job anchor translates to work (0,0) and
// preflight falls back to the size-only relative mode (the same mode Verified
// Origin uses even for Start, ADR-053). Demanding an active origin here
// stranded operators after an Abort — GRBL's soft reset wipes G92, so every
// later export was refused with "Set origin here first". Split from
// file-actions.test.ts for the 400-line file cap.

import { describe, expect, it, vi } from 'vitest';

import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveGcode } from './file-actions';

function mockPlatform(save: () => Promise<SaveTarget | null>): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
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

describe('handleSaveGcode export placement', () => {
  it('saves user-origin G-code with no connected machine and no active origin', async () => {
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: 'origin.gcode',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text G-code');
        written.push(data);
      },
    };

    await handleSaveGcode({
      platform: mockPlatform(async () => target),
      project: projectWithLine(),
      savedName: null,
      jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
      pushToast: () => undefined,
    });

    expect(alert).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('G1');
    vi.restoreAllMocks();
  });

  it('still refuses a current-position export without a live machine position', async () => {
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);
    const save = vi.fn(async () => null);

    await handleSaveGcode({
      platform: mockPlatform(save),
      project: projectWithLine(),
      savedName: null,
      jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
      pushToast: () => undefined,
    });

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toContain('Current Position');
    expect(save).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
