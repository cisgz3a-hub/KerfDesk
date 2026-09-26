// handleSaveRd coverage (CTL-10). The .rd binary export had zero tests, so a
// regression in a file bound for a CO2 laser would only surface on hardware.
// The key guard: the Blob handed to SaveTarget.write must be byte-equal to
// emitRdFile's output — locking the fix that passes the Uint8Array view itself
// instead of its underlying .buffer.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitRdFile } from '../../io/rd';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import type { SaveGcodeCtx } from './file-actions';
import { handleSaveRd } from './save-rd-action';

function ruidaLineProject(): Project {
  return {
    ...createProject(),
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' },
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

function mockPlatform(save: () => Promise<SaveTarget | null>): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

describe('handleSaveRd', () => {
  it('writes a Blob sized to the exact emitRdFile byte stream', async () => {
    const project = ruidaLineProject();
    // Blob.size is the discriminator for the buffer-cast bug: a subarray's
    // .buffer would blow the Blob up to the whole underlying buffer, so a
    // size mismatch is exactly the regression this guards. (jsdom's Blob has
    // no arrayBuffer(), so size is the byte-count check available here.)
    const writes: Blob[] = [];
    const target: SaveTarget = {
      displayName: 'job.rd',
      write: async (data) => {
        if (!(data instanceof Blob)) throw new Error('expected a Blob for .rd');
        writes.push(data);
      },
    };
    const messages: string[] = [];
    const ctx: SaveGcodeCtx = {
      platform: mockPlatform(async () => target),
      project,
      savedName: null,
      pushToast: (message) => messages.push(message),
    };

    await handleSaveRd(ctx, { ok: true });

    const expected = emitRdFile(project);
    if (!expected.ok) throw new Error('fixture should emit ok');
    expect(writes).toHaveLength(1);
    const blob = writes[0];
    if (blob === undefined) throw new Error('nothing was written');
    expect(blob.size).toBe(expected.bytes.length);
    // The experimental-.rd warning must always accompany a successful save.
    expect(messages.some((m) => m.includes('EXPERIMENTAL .rd export'))).toBe(true);
  });

  // Rule 7 / ADR-228: a pre-emit policy finding stopped refusing this export,
  // so it must now be SHOWN. Without this the fix trades a refusal for silence.
  it('toasts a pre-emit policy advisory after a successful save', async () => {
    const base = ruidaLineProject();
    const project: Project = {
      ...base,
      device: { ...base.device, controlledLaserOffTravelFeedMmPerMin: 0 },
    };
    const target: SaveTarget = { displayName: 'job.rd', write: async () => undefined };
    const messages: string[] = [];
    const ctx: SaveGcodeCtx = {
      platform: mockPlatform(async () => target),
      project,
      savedName: null,
      pushToast: (message) => messages.push(message),
    };

    await handleSaveRd(ctx, { ok: true });

    const emitted = emitRdFile(project);
    if (!emitted.ok) throw new Error('fixture should emit ok');
    expect(emitted.advisories.length).toBeGreaterThan(0);
    for (const advisory of emitted.advisories) {
      expect(messages).toContain(advisory.message);
    }
  });

  // Audit RU-7: Save checks the .rd moves in the frame Save G-code uses. With
  // no trusted controller-to-bed offset (no confirmed homing on this profile)
  // an enabled zone is reported as not checkable instead of skipped silently.
  it('toasts the no-go zone advisory in the Save G-code frame', async () => {
    const base = ruidaLineProject();
    const zone = { id: 'z', name: 'Clamp', enabled: true, x: 300, y: 300, width: 10, height: 10 };
    const project: Project = { ...base, device: { ...base.device, noGoZones: [zone] } };
    const target: SaveTarget = { displayName: 'job.rd', write: async () => undefined };
    const messages: string[] = [];
    const ctx: SaveGcodeCtx = {
      platform: mockPlatform(async () => target),
      project,
      savedName: null,
      pushToast: (message) => messages.push(message),
    };

    await handleSaveRd(ctx, { ok: true });

    expect(
      messages.filter((message) => message.includes('No-go zones cannot be checked')),
    ).toHaveLength(1);
    // The machine frame would have found this zone clear of the line.
    const machineFrame = emitRdFile(project);
    if (!machineFrame.ok) throw new Error('fixture should emit ok');
    expect(machineFrame.advisories).toEqual([]);
  });

  it('alerts and writes nothing when the job cannot be emitted', async () => {
    let picked = false;
    const ctx: SaveGcodeCtx = {
      platform: mockPlatform(async () => {
        picked = true;
        return null;
      }),
      project: createProject(), // no output geometry → emitRdFile refuses
      savedName: null,
      pushToast: () => undefined,
    };

    await handleSaveRd(ctx, { ok: true });

    // Refused before ever reaching the file picker.
    expect(picked).toBe(false);
  });
});
