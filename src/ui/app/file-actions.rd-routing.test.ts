// handleSaveGcode save-format routing (CTL-07). The dispatch to the binary .rd
// path must key on the driver's file-only transport capability, not a
// `controllerKind === 'ruida'` string match (ADR-094 bans kind checks in ui/).
// Proven by the output type handed to SaveTarget.write: a Blob for .rd, a
// string for G-code text. Lives in its own file — file-actions.test.ts is at
// the 400-line cap.

import { describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveGcode } from './file-actions';

function lineProject(controllerKind: 'grbl-v1.1' | 'ruida'): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, controllerKind },
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

function mockPlatform(target: SaveTarget): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => target,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

async function savedPayload(project: Project): Promise<string | Blob> {
  const writes: (string | Blob)[] = [];
  const target: SaveTarget = {
    displayName: 'job',
    write: async (data) => {
      writes.push(data);
    },
  };
  await handleSaveGcode({
    platform: mockPlatform(target),
    project,
    savedName: null,
    pushToast: () => undefined,
  });
  expect(writes).toHaveLength(1);
  const payload = writes[0];
  if (payload === undefined) throw new Error('nothing was written');
  return payload;
}

describe('handleSaveGcode save-format routing', () => {
  it('routes a file-only (Ruida) profile to the binary .rd path', async () => {
    expect(await savedPayload(lineProject('ruida'))).toBeInstanceOf(Blob);
  });

  it('routes a serial (GRBL) profile to the G-code text path', async () => {
    expect(typeof (await savedPayload(lineProject('grbl-v1.1')))).toBe('string');
  });
});
