import { describe, expect, it } from 'vitest';
import {
  settingsMapToControllerSettings,
  settingsMapToProfilePatch,
  settingsMapToRows,
} from '../controllers/grbl';
import { suggestMachineProfiles } from './profile-suggestions';

const FALCON_SETTINGS = new Map<number, string>([
  [30, '1000'],
  [31, '0'],
  [32, '1'],
  [110, '36000'],
  [111, '36000'],
  [120, '2500'],
  [121, '2500'],
  [130, '400'],
  [131, '400'],
]);

describe('suggestMachineProfiles', () => {
  it('reports matching firmware profiles as possible without identifying hardware from generic settings', () => {
    const suggestions = suggestMachineProfiles({
      detectedControllerKind: 'grblhal',
      detectedProfilePatch: settingsMapToProfilePatch(FALCON_SETTINGS),
      controllerSettings: settingsMapToControllerSettings(FALCON_SETTINGS),
      settingsRows: settingsMapToRows(FALCON_SETTINGS),
    });

    expect(suggestions[0]).toMatchObject({
      profileId: 'creality-falcon-a1-pro-grblhal',
      confidence: 'possible',
    });
    expect(suggestions[0]?.reasons).toEqual(
      expect.arrayContaining([
        'Detected grblHAL firmware.',
        'Controller reports a 400 x 400 mm work area.',
        'Controller reports S range 0-1000.',
      ]),
    );
    expect(suggestions.some((suggestion) => suggestion.confidence === 'suggested')).toBe(false);
  });

  it('keeps generic grblHAL possible instead of replacing the Falcon suggestion', () => {
    const suggestions = suggestMachineProfiles({
      detectedControllerKind: 'grblhal',
      detectedProfilePatch: settingsMapToProfilePatch(FALCON_SETTINGS),
      controllerSettings: settingsMapToControllerSettings(FALCON_SETTINGS),
      settingsRows: settingsMapToRows(FALCON_SETTINGS),
    });

    const ids = suggestions.map((suggestion) => suggestion.profileId);
    expect(ids.indexOf('creality-falcon-a1-pro-grblhal')).toBeLessThan(
      ids.indexOf('generic-grblhal'),
    );
    expect(
      suggestions.find((suggestion) => suggestion.profileId === 'generic-grblhal'),
    ).toMatchObject({
      confidence: 'possible',
    });
  });

  it('marks mismatched controller profiles manual-only with warnings', () => {
    const suggestions = suggestMachineProfiles({
      detectedControllerKind: 'grblhal',
      detectedProfilePatch: settingsMapToProfilePatch(FALCON_SETTINGS),
      controllerSettings: settingsMapToControllerSettings(FALCON_SETTINGS),
      settingsRows: settingsMapToRows(FALCON_SETTINGS),
    });

    expect(
      suggestions.find((suggestion) => suggestion.profileId === 'generic-marlin-laser'),
    ).toMatchObject({
      confidence: 'manual-only',
      warnings: expect.arrayContaining(['Profile controller is marlin, but detected grblhal.']),
    });
  });
});
