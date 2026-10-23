import { describe, expect, it } from 'vitest';
import { prepareConsoleCommand } from './grbl/console-command';
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

  it.each([
    '$075=SyntheticWifi',
    '$00077=SyntheticAP',
    '$03 30 =SyntheticAdmin',
    '$0 3 3 1=SyntheticUser',
    '$ 0 0 5 3 3 =SyntheticBroker',
  ])('masks the accepted padded password assignment %s', (command) => {
    expect(prepareConsoleCommand(command)).toMatchObject({
      ok: true,
      command: { kind: 'setting-write' },
    });
    const prefix = command.slice(0, command.indexOf('=') + 1);
    expect(maskControllerPasswords(command)).toBe(`${prefix}[password removed]`);
  });

  it.each(['$+075.000=SyntheticWifi', '$077 . 0 0 =SyntheticAP'])(
    'masks the equivalent firmware setting ID in %s',
    (command) => {
      expect(prepareConsoleCommand(command).ok).toBe(true);
      const prefix = command.slice(0, command.indexOf('=') + 1);
      expect(maskControllerPasswords(command)).toBe(`${prefix}[password removed]`);
    },
  );

  it.each([
    '$75x=SyntheticWifi',
    '$+077.0001=SyntheticAP',
    '$0330.0001=SyntheticAdmin',
    '$0331tail=SyntheticUser',
    '$0 5 3 3 . 000001suffix=SyntheticBroker',
  ])('masks the numeric password prefix grblHAL accepts in %s', (command) => {
    expect(prepareConsoleCommand(command).ok).toBe(true);
    const prefix = command.slice(0, command.indexOf('=') + 1);
    expect(maskControllerPasswords(command)).toBe(`${prefix}[password removed]`);
  });

  it('leaves other settings alone and does not run on into escaped text', () => {
    for (const text of [
      '$7500=1',
      '$07500=1',
      '$03310=1',
      '$75 00=1',
      '$0331 0=1',
      '$5330suffix=1',
      '$1075=1',
      '$74=MyNetwork',
      '$532=mqtt-user',
      '$330',
    ]) {
      expect(maskControllerPasswords(text)).toBe(text);
    }
    const once = maskControllerPasswords('$77=apSecret77');
    expect(maskControllerPasswords(`${once}\\nnext line`)).toBe(`${once}\\nnext line`);
  });
});
