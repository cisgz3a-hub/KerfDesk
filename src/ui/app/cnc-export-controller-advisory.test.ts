// CN-1 (2026-09-25 controller audit): a CNC export for a profile whose
// controller cannot run KerfDesk CNC jobs says the file is GRBL-dialect, as a
// non-blocking advisory; the bytes and the save are unchanged. Adapted from
// the audit's reproduction test.
//
// Marlin 2.1.2.8 gcode/motion/G4.cpp:33 reads the emitted `G4 P3.000` as 3 ms;
// Smoothieware (38e2cc08) Robot.cpp:694-696 has M0 commented out.

import { describe, expect, it } from 'vitest';
import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import type { DeviceProfile } from '../../core/devices';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
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
import type { SaveTarget } from '../../platform/types';
import {
  CNC_EXPORT_OTHER_CONTROLLERS_NOTE,
  cncExportControllerAdvisory,
  cncExportOtherControllersNote,
  cncProjectExportAdvisories,
} from './cnc-export-controller-advisory';
import { handleSaveGcode } from './file-actions';

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

describe('cncExportControllerAdvisory', () => {
  it.each([
    ['generic-marlin-laser', 'Marlin'],
    ['generic-smoothieware', 'Smoothieware'],
    ['generic-ruida-rd-export', 'Ruida (.rd export)'],
  ])('%s: names the GRBL-family requirement and the controller', (profileId, label) => {
    const advisory = cncExportControllerAdvisory(catalogProfile(profileId));
    expect(advisory).toMatch(/GRBL-family/);
    expect(advisory).toContain(`(${label}) cannot run KerfDesk CNC jobs`);
    expect(advisory).toContain('G4 P');
    expect(advisory).toContain('M0');
  });

  it('says nothing for the GRBL family, including the Falcon command set', () => {
    for (const controllerKind of ['grbl-v1.1', 'grblhal', 'fluidnc'] as const) {
      const device = { ...catalogProfile('generic-marlin-laser'), controllerKind };
      expect(cncExportControllerAdvisory(device)).toBeNull();
    }
    expect(
      cncExportControllerAdvisory({
        ...catalogProfile('generic-marlin-laser'),
        controllerKind: 'grblhal',
        controllerCommandSet: 'creality-falcon-a1-pro',
      }),
    ).toBeNull();
  });

  it('applies to a project Save only when the project is a CNC project', () => {
    const marlin = catalogProfile('generic-marlin-laser');
    expect(cncProjectExportAdvisories(cncProjectFor(marlin))).toHaveLength(1);
    expect(cncProjectExportAdvisories(createProject(marlin))).toEqual([]);
  });
});

describe('Save G-code of a CNC project for a controller that cannot run it', () => {
  it.each(['generic-marlin-laser', 'generic-smoothieware'])(
    '%s: saves the GRBL CNC file and states that it is GRBL-family only',
    async (profileId) => {
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
        project: cncProjectFor(catalogProfile(profileId)),
        savedName: null,
        // A connected Marlin/Smoothieware board: no $-settings dump.
        controllerSettings: null,
        settingsCapability: 'none',
        pushToast: toast.pushToast,
      });
      // The save itself still succeeds with the unchanged GRBL bytes.
      expect(typeof written).toBe('string');
      expect(String(written)).toContain('\nM3 S12000\nG4 P3.000\n');
      const advisories = toast.messages.filter((m) => /GRBL-family/.test(m.message));
      expect(advisories).toHaveLength(1);
      expect(advisories[0]?.variant).toBe('warning');
    },
  );

  it('says nothing extra when the profile is disconnected GRBL', async () => {
    const toast = toasts();
    const target: SaveTarget = { displayName: 'cn-audit.gcode', write: async () => undefined };
    await handleSaveGcode({
      platform: mockPlatform({ save: async () => target }),
      project: cncProjectFor({
        ...catalogProfile('generic-marlin-laser'),
        controllerKind: 'grbl-v1.1',
      }),
      savedName: null,
      pushToast: toast.pushToast,
    });
    expect(toast.messages.some((m) => /GRBL-family/.test(m.message))).toBe(false);
  });
});

// The audit's CNC controller research: owners of PC and stand-alone
// controllers (Mach3/4, MASSO, UCCNC, Centroid, RepRapFirmware) pick a GRBL
// profile, since KerfDesk cannot connect to theirs, so only a note on a
// GRBL-family export reaches them.
describe('the note for PC and stand-alone controllers', () => {
  const grbl = { ...catalogProfile('generic-marlin-laser'), controllerKind: 'grbl-v1.1' as const };

  it('names the controllers and both commands on a GRBL profile no controller confirmed', () => {
    const note = cncExportOtherControllersNote(grbl, null);
    expect(note).toBe(CNC_EXPORT_OTHER_CONTROLLERS_NOTE);
    expect(note).toMatch(
      /MASSO, UCCNC and RepRapFirmware take the G4 P spin-up dwell as milliseconds/,
    );
    expect(note).toContain('M0');
  });

  it('is left out once a connected controller confirmed the profile', () => {
    const settings = { maxPowerS: 12000, bedWidth: 400, bedHeight: 400, laserModeEnabled: false };
    expect(cncExportOtherControllersNote(grbl, settings)).toBeNull();
  });

  it('is left out where the GRBL-family warning already applies', () => {
    expect(cncExportOtherControllersNote(catalogProfile('generic-marlin-laser'), null)).toBeNull();
  });

  it('Save G-code of a CNC project on a disconnected GRBL profile shows it as info', async () => {
    const toast = toasts();
    const target: SaveTarget = { displayName: 'cn-audit.gcode', write: async () => undefined };
    await handleSaveGcode({
      platform: mockPlatform({ save: async () => target }),
      project: cncProjectFor(grbl),
      savedName: null,
      controllerSettings: null,
      settingsCapability: 'none',
      pushToast: toast.pushToast,
    });
    const notes = toast.messages.filter((m) => m.message === CNC_EXPORT_OTHER_CONTROLLERS_NOTE);
    expect(notes).toEqual([{ message: CNC_EXPORT_OTHER_CONTROLLERS_NOTE, variant: 'info' }]);
  });
});
