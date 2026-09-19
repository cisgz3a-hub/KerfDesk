import { describe, expect, it } from 'vitest';
import { emitGcode } from '../../io/gcode';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from '../../io/machine-profile';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../scene';
import { deviceSupportsMachineKind, type DeviceProfile } from './device-profile';
import { GRBL_MACHINE_PROFILE_CATALOG, profileCatalogEntryById } from './profile-catalog';
import { profileConfidenceLabel } from './profile-confidence';
import { profileWithControllerFacts } from './profile-application';

function profile(id: string): DeviceProfile {
  const result = profileCatalogEntryById(id)?.profile;
  if (result === undefined) throw new Error(`Missing profile ${id}`);
  return result;
}

function lineProject(device: DeviceProfile, x = 20, y = 20, airAssist = false): Project {
  const color = '#ff0000';
  return {
    ...createProject(device),
    scene: {
      layers: [{ ...createLayer({ id: 'line', color }), airAssist, power: 50 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-object',
          source: 'line.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: x - 1, minY: y, maxX: x, maxY: y },
          paths: [
            {
              color,
              polylines: [
                {
                  points: [
                    { x: x - 1, y },
                    { x, y },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function boundsWarning(id: string, x: number, y: number): boolean {
  return emitGcode(lineProject(profile(id), x, y)).preflight.issues.some(
    (issue) => issue.code === 'out-of-bed',
  );
}

describe('researched catalogue output contracts', () => {
  it('turns on and shuts down the stock S30 pump while leaving the manual variant alone', () => {
    const stock = emitGcode(lineProject(profile('sculpfun-s30'), 20, 20, true)).gcode;
    expect(stock).toMatch(/^M8$/m);
    expect(stock).toMatch(/^M9$/m);
    expect(stock.indexOf('M8')).toBeLessThan(stock.indexOf('G1 X20.000'));
    expect(stock.lastIndexOf('M9')).toBeGreaterThan(stock.indexOf('G1 X20.000'));
    const manual = emitGcode(lineProject(profile('sculpfun-s30-manual-air'), 20, 20, true)).gcode;
    expect(manual).not.toMatch(/^M[78]$/m);
  });

  it('uses the vendor Falcon X/Y assignment for output bounds warnings', () => {
    const id = 'creality-falcon-a1-pro-grblhal';
    expect(boundsWarning(id, 350, 260)).toBe(false);
    expect(boundsWarning(id, 360, 260)).toBe(true);
    expect(boundsWarning(id, 350, 270)).toBe(true);
  });

  it('changes the bounds advisory for the fitted xTool head', () => {
    expect(boundsWarning('xtool-d1-pro', 20, 360)).toBe(false);
    expect(boundsWarning('xtool-d1-pro-40w', 20, 360)).toBe(true);
    expect(boundsWarning('xtool-d1-pro-5w', 20, 395)).toBe(false);
    expect(boundsWarning('xtool-d1-pro-10w', 20, 395)).toBe(false);
    expect(boundsWarning('xtool-d1-pro', 20, 395)).toBe(true);
  });

  it('changes the bounds advisory for the fitted Ortur head', () => {
    expect(boundsWarning('ortur-laser-master-3', 20, 390)).toBe(false);
    expect(boundsWarning('ortur-laser-master-3-20w', 20, 390)).toBe(true);
    expect(boundsWarning('ortur-laser-master-3-40w', 20, 390)).toBe(true);
  });

  it('offers CNC mismatch advisories for named lasers while retaining legacy imports', () => {
    const namedLasers = GRBL_MACHINE_PROFILE_CATALOG.filter(
      ({ profile: item }) => item.vendor !== 'Generic' && item.vendor !== 'Neotronics',
    );
    for (const { profile: item } of namedLasers) {
      expect(deviceSupportsMachineKind(item, 'laser'), item.name).toBe(true);
      expect(deviceSupportsMachineKind(item, 'cnc'), item.name).toBe(false);
    }
    // Old profiles without explicit output-kind metadata remain loadable and
    // retain their compatibility behaviour; a catalogue update is not migration.
    expect(deviceSupportsMachineKind({ capabilities: ['grbl'] }, 'cnc')).toBe(true);
    expect(deviceSupportsMachineKind(profile('neotronics-4040-max-lt4lds-v2-20w'), 'cnc')).toBe(
      true,
    );
  });

  it('uses FluidNC default laser S255 but lets reported configuration replace that starter', () => {
    const fluid = profile('generic-fluidnc');
    const starter = emitGcode(lineProject(fluid)).gcode;
    expect(starter).toMatch(/G1[^\n]*S128/);
    const configured = profileWithControllerFacts({
      profile: fluid,
      current: fluid,
      detectedSettings: { maxPowerS: 1000 },
      controllerSettings: null,
      detectedControllerKind: 'fluidnc',
      lastSettingsReadAt: 1,
    });
    expect(emitGcode(lineProject(configured)).gcode).toMatch(/G1[^\n]*S500/);
  });

  it.each([
    ['researched', 'Researched / untested'],
    ['unverified', 'Unverified'],
  ] as const)('keeps legacy %s evidence honest after machine-file import', (status, label) => {
    const imported = {
      ...profile('sculpfun-s30'),
      airAssistCommand: 'none' as const,
      bedWidth: 402,
      evidence: [{ label: 'Legacy source', status, note: 'No simulator or hardware record.' }],
    };
    const result = deserializeMachineProfileDocument(
      serializeMachineProfileDocument({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile: imported,
        source: { kind: 'imported', label: 'Legacy machine' },
        reviewNotes: [],
      }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('Expected import');
    expect(profileConfidenceLabel(result.document.profile)).toBe(label);
    expect(result.document.profile.airAssistCommand).toBe('none');
    expect(result.document.profile.bedWidth).toBe(402);
    expect(result.document.profile.profileId).toBe('sculpfun-s30');
  });
});
