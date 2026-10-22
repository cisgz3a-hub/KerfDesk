// OR-4 (2026-09-25 controller audit, plausible only): xTool's own LightBurn
// device file for the D1 Pro sets "EnableGrblJCommand": false
// (https://xtool.zendesk.com/hc/article_attachments/7316804567447/xTool-D1ProV3.lbdev).
// Whether the closed firmware rejects `$J=` is not public, so the decision is to
// keep the GRBL `$J=` jog and Frame and state the fact and its consequence in
// the profile's evidence note, which Machine Setup shows under Profile details.

import { describe, expect, it } from 'vitest';
import { selectControllerDriver } from '../controllers';
import { consoleSettingWriteIssue } from '../controllers/console-setting-writes';
import { GRBLHAL_DEFAULT_RX_BUFFER_BYTES } from '../grbl-streaming';
import { ORTUR_LASER_MASTER_3_PROFILES, XTOOL_D1_PRO_PROFILES } from './brand-laser-profiles';
import { suggestMachineProfiles } from './profile-suggestions';

describe('xTool D1 Pro profiles and $J= jogging (OR-4)', () => {
  it.each(XTOOL_D1_PRO_PROFILES.map((profile) => [profile.profileId, profile] as const))(
    '%s keeps the GRBL $J= jog and says what an error means',
    (_id, profile) => {
      const driver = selectControllerDriver(profile.controllerKind, profile.controllerCommandSet);
      expect(driver.commands.buildJog({ dx: 1, feed: 600 })).toMatch(/^\$J=/);
      const note = profile.evidence?.map((item) => item.note).join(' ') ?? '';
      expect(note).toContain('EnableGrblJCommand: false');
      expect(note).toContain(
        'if Jog or Frame fails with an error on this firmware, the machine is not compatible with $J= jogging',
      );
    },
  );
});

// Controller audit v2 C7-P2-2 (ADR-660): the LM3 runs Ortur's grblHAL-based OLF
// 2.x. Ortur's LM3 manual sets Wi-Fi with grblHAL's $74/$75, and LM3 startup
// reports read [FIRMWARE:grblHAL]. Declared as stock GRBL, the picker called the
// owner's own rows "Other firmware", the Console refused grblHAL's $22 bitfield,
// and the stock driver never cleared grblHAL's latched line error.
describe('Ortur Laser Master 3 profiles run grblHAL (C7-P2-2)', () => {
  it.each(ORTUR_LASER_MASTER_3_PROFILES.map((profile) => [profile.profileId, profile] as const))(
    '%s binds the grblHAL driver with S1000 and the grblHAL window',
    (_id, profile) => {
      expect(profile.controllerKind).toBe('grblhal');
      expect(profile.maxPowerS).toBe(1000);
      expect(profile.rxBufferBytes).toBe(GRBLHAL_DEFAULT_RX_BUFFER_BYTES);
      const driver = selectControllerDriver(profile.controllerKind, profile.controllerCommandSet);
      expect(driver.kind).toBe('grblhal');
      expect(driver.capabilities.stickyLineError).toBe(true);
      const homing = { kind: 'setting-write', normalized: '$22=5' };
      expect(consoleSettingWriteIssue(driver, homing)).toBeNull();
      expect(consoleSettingWriteIssue(selectControllerDriver('grbl-v1.1'), homing)).not.toBeNull();
      const note = profile.evidence?.map((item) => item.note).join(' ') ?? '';
      expect(note).toContain('Ortur Laser Firmware (OLF) 2.x');
      expect(note).toContain('"$74=WiFi name"');
    },
  );

  it('shows every Ortur row as the same firmware when the controller reports grblHAL', () => {
    const suggestions = suggestMachineProfiles({
      detectedControllerKind: 'grblhal',
      detectedProfilePatch: null,
      controllerSettings: null,
      settingsRows: [],
    });
    for (const profile of ORTUR_LASER_MASTER_3_PROFILES) {
      expect(
        suggestions.find((suggestion) => suggestion.profileId === profile.profileId),
      ).toMatchObject({ confidence: 'possible', warnings: [] });
    }
  });
});
