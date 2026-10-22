import { describe, expect, it } from 'vitest';
import {
  GRBLHAL_PASSWORD_SETTING_IDS,
  isGrblhalPasswordSetting,
  maskControllerPasswords,
} from './controller-password-settings';

describe('controller password settings', () => {
  it('lists the grblHAL Format_Password settings and nothing near them', () => {
    expect(GRBLHAL_PASSWORD_SETTING_IDS).toEqual([75, 77, 330, 331, 533]);
    for (const id of [75, 77, 330, 331, 533]) expect(isGrblhalPasswordSetting(id)).toBe(true);
    // SSIDs, the MQTT user name, a port and the setting after the MQTT password.
    for (const id of [74, 76, 532, 531, 534, 7, 750])
      expect(isGrblhalPasswordSetting(id)).toBe(false);
  });

  it('removes each password value to the end of its line', () => {
    expect(maskControllerPasswords('$75=hunter2 pass\n$100=80.000')).toBe(
      '$75=[password removed]\n$100=80.000',
    );
    expect(maskControllerPasswords('dispatched: $533=mqttSecret9')).toBe(
      'dispatched: $533=[password removed]',
    );
    expect(maskControllerPasswords('$Sta/Password=wifi\r\n[ESP106]apSecret')).toBe(
      '$Sta/Password=[password removed]\r\n[ESP106][password removed]',
    );
  });

  it('leaves other settings alone and does not run on into escaped text', () => {
    for (const text of ['$7500=1', '$1075=1', '$74=MyNetwork', '$532=mqtt-user', '$330']) {
      expect(maskControllerPasswords(text)).toBe(text);
    }
    const once = maskControllerPasswords('$77=apSecret77');
    expect(maskControllerPasswords(`${once}\\nnext line`)).toBe(`${once}\\nnext line`);
  });
});
