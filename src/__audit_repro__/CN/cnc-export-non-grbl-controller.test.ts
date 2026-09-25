// Audit track CN (2026-09-25) — CNC export for a controller that cannot run
// KerfDesk CNC jobs.
//
// Correct behaviour: when a CNC project is saved for a device profile whose
// driver reports capabilities.cncJobs === false (Marlin, Smoothieware), the
// Save flow states, as a NON-BLOCKING advisory, that the file is GRBL-dialect
// CNC G-code for a GRBL-family controller — the same fact the Start path already
// states as CNC_REQUIRES_GRBL_MESSAGE (start-job-readiness-policy.ts:20-28) and
// Machine Setup states as a validation issue (device-setup-flow.ts:391-393).
// The bytes and the save itself stay unchanged (rule 7 / ADR-228: no refusal).
//
// Why the file is wrong for those controllers (upstream, pinned trees):
// - Marlin 2.1.2.8 Marlin/src/gcode/motion/G4.cpp:33
//     if (parser.seenval('P')) dwell_ms = parser.value_millis(); // milliseconds to wait
//   Marlin/src/gcode/parser.h:280  static millis_t value_millis() { return value_ulong(); }
//   so the emitted spin-up dwell `G4 P3.000` waits 3 ms, not 3 s, and
//   Marlin/src/feature/spindle_laser.h:223 power_delay() is never called, so M3
//   itself adds no spin-up wait.
//   https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/G4.cpp#L33
// - Smoothieware edge 38e2cc08 src/modules/robot/Robot.cpp:503-511: P is decimal
//   seconds only in grbl_mode; otherwise "in reprap P is milliseconds", and
//   grbl_mode defaults to false outside the CNC build (src/libs/Kernel.cpp:113-117).
//   Robot.cpp:694-696 has M0 commented out, so the tool-change M0 does not pause a
//   file the board plays itself.
//   https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L500-L511
//
// Expected result on current code: the "writes GRBL dialect" facts pass and the
// "Save states it is GRBL-only" tests FAIL (no such advisory exists).

import { describe, expect, it } from 'vitest';

import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import { selectControllerDriver } from '../../core/controllers';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import type { DeviceProfile } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { EMITTER_REVISION } from '../../io/gcode/gcode-metadata';
import { emitGcode } from '../../io/gcode/emit-gcode';
import type { SaveTarget } from '../../platform/types';
import { handleSaveGcode } from '../../ui/app/file-actions';

const PROFILES = ['generic-marlin-laser', 'generic-smoothieware'] as const;

function catalogProfile(profileId: string): DeviceProfile {
  const entry = profileCatalogEntryById(profileId);
  if (entry === undefined) throw new Error(`missing catalog profile ${profileId}`);
  return entry.profile;
}

function squareObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'cn-audit.svg',
    bounds: { minX: 10, minY: 10, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 60, y: 10 },
              { x: 60, y: 60 },
              { x: 10, y: 60 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function cncProjectFor(device: DeviceProfile): Project {
  const base = createProject({ ...device, homing: { enabled: false, direction: 'front-left' } });
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), cnc: DEFAULT_CNC_LAYER_SETTINGS };
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: addLayer(addObject(base.scene, squareObject()), layer),
  };
}

describe('CN: CNC output for controllers with cncJobs === false', () => {
  it.each(PROFILES)('%s: KerfDesk itself marks the controller as unable to run CNC jobs', (id) => {
    const device = catalogProfile(id);
    expect(selectControllerDriver(device.controllerKind).capabilities.cncJobs).toBe(false);
  });

  it.each(PROFILES)('%s: the CNC export is the GRBL CNC dialect regardless (fact)', (id) => {
    const { gcode, preflight } = emitGcode(cncProjectFor(catalogProfile(id)), {
      metadata: {
        appName: 'KerfDesk',
        appVersion: 'audit',
        gitSha: 'audit',
        buildTimeUtc: '2026-09-25T00:00:00Z',
        emitterRevision: EMITTER_REVISION,
      },
    });
    expect(preflight.issues.filter((issue) => issue.code === 'coordinate-unencodable')).toEqual([]);
    // Spin-up dwell in GRBL seconds form (cnc-grbl-transitions.ts:128).
    expect(gcode).toContain('\nM3 S12000\nG4 P3.000\n');
    // The only dialect statement is a comment inside the file.
    expect(gcode).toContain('; assumes: GRBL $30=12000');
  });

  it('models Marlin reading the emitted dwell: strtoul("3.000") = 3 -> 3 ms, not 3000 ms', () => {
    // Marlin parser.h value_ulong() is strtoul(value_ptr, nullptr, 10); the integer
    // prefix of "3.000" is 3 and G4.cpp treats it as milliseconds.
    const marlinDwellMs = Number.parseInt('3.000', 10);
    const intendedMs = 3 * 1000;
    expect(marlinDwellMs).toBe(3);
    expect(marlinDwellMs).not.toBe(intendedMs);
  });

  it.each(PROFILES)(
    '%s: Save G-code tells the operator the file is GRBL-family only (FAILS on current code)',
    async (id) => {
      const toast = toasts();
      let written: string | Blob | null = null;
      const target: SaveTarget = {
        displayName: 'cn-audit.gcode',
        write: async (data) => {
          written = data;
        },
      };
      await handleSaveGcode({
        platform: mockPlatform({ save: async () => target }),
        project: cncProjectFor(catalogProfile(id)),
        savedName: null,
        // A connected Marlin/Smoothieware board: no $-settings dump.
        controllerSettings: null,
        settingsCapability: 'none',
        pushToast: toast.pushToast,
      });
      // The save itself must still succeed (non-blocking), as it does today.
      expect(typeof written).toBe('string');
      expect(String(written)).toContain('G4 P3.000');
      const text = toast.messages.map((m) => m.message).join('\n');
      // Correct behaviour: an advisory names the GRBL-family requirement.
      expect(text).toMatch(/GRBL-family/);
    },
  );
});
