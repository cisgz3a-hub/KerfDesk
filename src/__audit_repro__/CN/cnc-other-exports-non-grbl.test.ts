// Audit track CN (2026-09-25) — the OTHER CNC export paths (per-tile Save and
// the spoilboard surfacing Save) for a device profile whose driver reports
// capabilities.cncJobs === false.
//
// Correct behaviour: exactly as for the single-file Save (see
// cnc-export-non-grbl-controller.test.ts), every CNC export for such a profile
// states, as a NON-BLOCKING advisory, that the file is GRBL-dialect CNC G-code
// for a GRBL-family controller (the fact CNC_REQUIRES_GRBL_MESSAGE already
// states at Start, start-job-readiness-policy.ts:20-21). Bytes and saves stay
// unchanged (rule 7 / ADR-228: no refusal is being asked for).
//
// Also pinned as a fact: with tiling on, Save on the file-only Ruida profile
// never reaches the .rd route (file-actions.ts runs handleSaveTiledGcode before
// the transport === 'file-only' check), so it writes GRBL .nc tiles for a
// controller that cannot run G-code, while the untiled Save of the same project
// refuses with the .rd "Fill/Image raster" message (CN-3).
//
// Why the bytes are wrong for these controllers (pinned upstream trees):
// - Marlin 2.1.2.8 Marlin/src/gcode/motion/G4.cpp:33
//     if (parser.seenval('P')) dwell_ms = parser.value_millis(); // milliseconds to wait
//   https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/G4.cpp#L33
//   so `G4 P3.000` (3 s in GRBL, grbl/motion_control.c mc_dwell(float seconds)) waits 3 ms.
// - Smoothieware 38e2cc08 src/modules/robot/Robot.cpp:694-696 has M0 commented
//   out, so the tool-change M0 does not pause a file the board plays itself.
//   https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L694-L696
//
// Expected result on current code: the "fact" tests pass and the three
// "correct behaviour" tests FAIL (no GRBL-family advisory on these paths).

import { describe, expect, it, vi } from 'vitest';

import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import { selectControllerDriver } from '../../core/controllers';
import type { DeviceProfile } from '../../core/devices';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveGcode } from '../../ui/app/file-actions';
import { capturingPlatform, tiledCncProject } from '../../ui/app/save-tiled-gcode-testing';
import { finalizeTiledOutput } from '../../ui/app/tiled-output-preparation';
import type { TiledOutputPreparationRequest } from '../../ui/laser/output-preparation-protocol';
import type * as OutputPreparationWorkerClient from '../../ui/laser/output-preparation-worker-client';
import { saveSurfacingProgram } from '../../ui/machine/save-surfacing-program';
import type { SurfacingWorkerInput } from '../../ui/machine/surfacing-worker-protocol';
import type * as JobAwareDialogs from '../../ui/state/job-aware-dialogs';

// Same seams the production tests replace: the tiled Worker returns the
// finalized result the UI-realm path would compute, and the surfacing Worker
// runs its real generation/preflight in-process.
vi.mock('../../ui/laser/output-preparation-worker-client', async (importOriginal) => {
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

vi.mock('../../ui/machine/surfacing-worker-client', async () => {
  const { prepareSurfacingStream } = await import('../../ui/machine/surfacing-worker-runtime');
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

// A jobAwareAlert() is how the .rd refusal reaches the operator.
const alerts: string[] = [];
vi.mock('../../ui/state/job-aware-dialogs', async (importOriginal) => {
  const actual = await importOriginal<typeof JobAwareDialogs>();
  return {
    ...actual,
    jobAwareAlert: (message: string) => {
      alerts.push(message);
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

describe('CN: tiled CNC Save on a Marlin profile', () => {
  it('Marlin cannot run KerfDesk CNC jobs (fact)', () => {
    expect(selectControllerDriver('marlin').capabilities.cncJobs).toBe(false);
  });

  it('writes GRBL-dialect tile files, with a GRBL-family advisory (advisory FAILS on current code)', async () => {
    const written: string[] = [];
    const toast = toasts();
    await handleSaveGcode({
      platform: capturingPlatform(written),
      project: tiledProjectOn(catalogProfile('generic-marlin-laser')),
      savedName: 'cn-audit',
      controllerSettings: null,
      settingsCapability: 'none',
      pushToast: toast.pushToast,
    });
    // Fact: the tiles were written, in the GRBL seconds dwell form.
    expect(written.length).toBeGreaterThan(0);
    for (const file of written) expect(file).toContain('G4 P3.000');
    const text = toast.messages.map((m) => m.message).join('\n');
    // Correct behaviour: the same non-blocking GRBL-family advisory as Start.
    expect(text).toMatch(/GRBL-family/);
  });
});

describe('CN: surfacing Save on a Marlin profile', () => {
  it('writes a GRBL-dialect surfacing file, with a GRBL-family advisory (advisory FAILS on current code)', async () => {
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
    // Fact: the surfacing program was written with the GRBL seconds dwell.
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('G4 P3.000');
    expect(written[0]).toContain('; assumes: GRBL $30=');
    const text = toast.messages.map((m) => m.message).join('\n');
    expect(text).toMatch(/GRBL-family/);
  });
});

describe('CN: CNC Save on the file-only Ruida profile', () => {
  it('untiled Save refuses through the .rd route with the raster message (fact, CN-3)', async () => {
    alerts.length = 0;
    const written: string[] = [];
    await handleSaveGcode({
      platform: capturingPlatform(written),
      project: untiledProjectOn(catalogProfile('generic-ruida-rd-export')),
      savedName: 'cn-audit',
      pushToast: () => undefined,
    });
    expect(written).toEqual([]);
    expect(alerts.join('\n')).toMatch(/Cannot save \.rd file/);
    expect(alerts.join('\n')).toMatch(/Fill\/Image raster/);
  });

  it('tiled Save bypasses the .rd route and writes GRBL .nc tiles (fact)', async () => {
    const written: string[] = [];
    await handleSaveGcode({
      platform: capturingPlatform(written),
      project: tiledProjectOn(catalogProfile('generic-ruida-rd-export')),
      savedName: 'cn-audit',
      pushToast: () => undefined,
    });
    expect(written.length).toBeGreaterThan(0);
    for (const file of written) expect(file).toContain('M3 S');
  });

  it('tiled Save states the GRBL-family requirement (FAILS on current code)', async () => {
    const toast = toasts();
    await handleSaveGcode({
      platform: capturingPlatform([]),
      project: tiledProjectOn(catalogProfile('generic-ruida-rd-export')),
      savedName: 'cn-audit',
      pushToast: toast.pushToast,
    });
    expect(toast.messages.map((m) => m.message).join('\n')).toMatch(/GRBL-family/);
  });
});
