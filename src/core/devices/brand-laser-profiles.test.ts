// OR-4 (2026-09-25 controller audit, plausible only): xTool's own LightBurn
// device file for the D1 Pro sets "EnableGrblJCommand": false
// (https://xtool.zendesk.com/hc/article_attachments/7316804567447/xTool-D1ProV3.lbdev).
// Whether the closed firmware rejects `$J=` is not public, so the decision is to
// keep the GRBL `$J=` jog and Frame and state the fact and its consequence in
// the profile's evidence note, which Machine Setup shows under Profile details.

import { describe, expect, it } from 'vitest';
import { selectControllerDriver } from '../controllers';
import { XTOOL_D1_PRO_PROFILES } from './brand-laser-profiles';

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
