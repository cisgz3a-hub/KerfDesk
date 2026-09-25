// CN-1 and CN-3 (2026-09-25 controller audit): tile export and surfacing
// export state the GRBL-family requirement too, for a profile whose controller
// cannot run KerfDesk CNC jobs. With tiling on, Save on the file-only Ruida
// profile keeps its routing (tiling runs before the .rd route and writes GRBL
// tiles) and now says so. Warning only; bytes and saves unchanged. Adapted from
// src/__audit_repro__/CN/cnc-other-exports-non-grbl.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import type { DeviceProfile } from '../../core/devices';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import type { TiledOutputPreparationRequest } from '../laser/output-preparation-protocol';
import type * as OutputPreparationWorkerClient from '../laser/output-preparation-worker-client';
import { saveSurfacingProgram } from '../machine/save-surfacing-program';
import type { SurfacingWorkerInput } from '../machine/surfacing-worker-protocol';
import { handleSaveGcode } from './file-actions';
import { capturingPlatform, tiledCncProject } from './save-tiled-gcode-testing';
import { finalizeTiledOutput } from './tiled-output-preparation';

// The same seams the production tests replace: the tiled Worker returns the
// finalized result the UI-realm path would compute, and the surfacing Worker
// runs its real generation and preflight in-process.
vi.mock('../laser/output-preparation-worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof OutputPreparationWorkerClient>();
  return {
    ...actual,
    prepareTiledOutputOffThread: (request: TiledOutputPreparationRequest) =>
      Promise.resolve(
        finalizeTiledOutput(
          prepareOutput(request.project, request.options),
          request.savedName,
          request.controllerSettings ?? null,
          request.activeWcs ?? null,
        ),
      ),
  };
});

vi.mock('../machine/surfacing-worker-client', async () => {
  const { prepareSurfacingStream } = await import('../machine/surfacing-worker-runtime');
  return {
    startSurfacingStream: (input: SurfacingWorkerInput, signal: AbortSignal) => {
      const session = prepareSurfacingStream(input);
      return {
        ready: Promise.resolve(session.prepared),
        chunks: {
          async *[Symbol.asyncIterator]() {
            for (let next = session.chunks.next(); !next.done; next = session.chunks.next()) {
              signal.throwIfAborted();
              yield next.value;
            }
          },
        },
        dispose: () => undefined,
      };
    },
  };
});

function catalogProfile(profileId: string): DeviceProfile {
  const entry = profileCatalogEntryById(profileId);
  if (entry === undefined) throw new Error(`missing catalog profile ${profileId}`);
  return { ...entry.profile, homing: { enabled: false, direction: 'front-left' } };
}

function tiledProjectOn(device: DeviceProfile): Project {
  return { ...tiledCncProject(), device };
}

function untiledProjectOn(device: DeviceProfile): Project {
  const tiled = tiledProjectOn(device);
  const machine = tiled.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC project');
  const { tiling: _tiling, ...rest } = machine;
  return { ...tiled, machine: rest };
}

function streamingPlatform(written: string[]): PlatformAdapter {
  const target: SaveTarget = {
    displayName: 'surfacing.nc',
    write: async (data) => {
      if (typeof data === 'string') written.push(data);
    },
    writeChunks: async (chunks) => {
      let text = '';
      for await (const chunk of chunks) text += chunk;
      written.push(text);
    },
  };
  return mockPlatform({ save: async () => target });
}

function grblFamilyAdvisories(messages: ReadonlyArray<{ readonly message: string }>) {
  return messages.filter((m) => /GRBL-family/.test(m.message));
}

describe('tiled CNC Save for a controller that cannot run it', () => {
  it.each([
    ['generic-marlin-laser', 'Marlin'],
    ['generic-ruida-rd-export', 'Ruida (.rd export)'],
  ])('%s: writes the GRBL tiles and states the GRBL-family requirement', async (id, label) => {
    const written: string[] = [];
    const toast = toasts();
    await handleSaveGcode({
      platform: capturingPlatform(written),
      project: tiledProjectOn(catalogProfile(id)),
      savedName: 'cn-audit',
      pushToast: toast.pushToast,
    });
    // Routing and bytes are unchanged: GRBL tiles with the seconds dwell.
    expect(written.length).toBeGreaterThan(0);
    for (const file of written) expect(file).toContain('G4 P3.000');
    const advisories = grblFamilyAdvisories(toast.messages);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.message).toContain(`(${label}) cannot run KerfDesk CNC jobs`);
  });
});

describe('surfacing Save for a controller that cannot run it', () => {
  it('writes the GRBL surfacing program and states the GRBL-family requirement', async () => {
    const written: string[] = [];
    const toast = toasts();
    const device = catalogProfile('generic-marlin-laser');
    await saveSurfacingProgram({
      platform: streamingPlatform(written),
      pushToast: toast.pushToast,
      project: { ...untiledProjectOn(device), device },
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      controllerSettings: null,
      settingsCapability: 'none',
      inputs: { widthMm: 100, heightMm: 80, stepoverPct: 40, totalDepthMm: 0.5 },
      signal: new AbortController().signal,
      onWriting: () => undefined,
      onFinalizing: () => undefined,
      isCurrent: () => true,
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('G4 P3.000');
    expect(grblFamilyAdvisories(toast.messages)).toHaveLength(1);
  });
});
