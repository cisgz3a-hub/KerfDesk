import { describe, expect, it, vi } from 'vitest';
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

  it.each([
    '$74.999999=SyntheticWifi',
    '$76.9999999=SyntheticAP',
    '$329.9999999=SyntheticAdmin',
    '$330.9999999=SyntheticUser',
    '$532.9999999=SyntheticBroker',
  ])('masks a numeric alias whose float32 firmware value is a password ID: %s', (command) => {
    expect(prepareConsoleCommand(command).ok).toBe(true);
    const prefix = command.slice(0, command.indexOf('=') + 1);
    expect(maskControllerPasswords(command)).toBe(`${prefix}[password removed]`);
  });

  it('bounds character work for repeated failed candidates and long padded keys', () => {
    for (const length of [2_048, 8_192]) {
      for (const text of [
        '$75x'.repeat(length),
        `$${'0 '.repeat(length)}74suffix`,
        `$${'0 '.repeat(length)}7500=visible`,
        `${'$75x'.repeat(length)}=[password removed]`,
      ]) {
        const characterReads = vi.spyOn(String.prototype, 'charAt');
        const codeReads = vi.spyOn(String.prototype, 'charCodeAt');
        let actual: string;
        let reads: number;
        try {
          actual = maskControllerPasswords(text);
          reads = characterReads.mock.calls.length + codeReads.mock.calls.length;
        } finally {
          characterReads.mockRestore();
          codeReads.mockRestore();
        }
        expect(actual).toBe(text);
        expect(reads).toBeLessThanOrEqual(text.length * 8 + 32);
        expect(reads).toBeGreaterThan(0);
      }
    }
  });

  it('handles multiple candidates and keeps masked values and physical line boundaries', () => {
    expect(maskControllerPasswords('$30suffix $74other $75suffix=SyntheticWifi')).toBe(
      '$30suffix $74other $75suffix=[password removed]',
    );
    expect(maskControllerPasswords('$30=1000 $74=VisibleSSID $75=SyntheticWifi')).toBe(
      '$30=1000 $74=VisibleSSID $75=[password removed]',
    );
    expect(maskControllerPasswords('$75=[password removed]\\n$533=SyntheticBroker')).toBe(
      '$75=[password removed]',
    );
    const text =
      '$75suffix=[password removed]\\nnext line\r\n$74=visible\n$329.9999999=SyntheticAdmin';
    const masked = '$75suffix=[password removed]\r\n$74=visible\n$329.9999999=[password removed]';
    expect(maskControllerPasswords(text)).toBe(masked);
    expect(maskControllerPasswords(masked)).toBe(masked);
    expect(maskControllerPasswords('$75suffix\n$30=1000')).toBe('$75suffix\n$30=1000');
  });

  it('retains FluidNC named and ESP password masking, including case and blank values', () => {
    expect(
      maskControllerPasswords(
        '$Sta/Password=SyntheticWifi\n$AP/Password =SyntheticAP\r\n[esp101]SyntheticStation\n[ESP106]',
      ),
    ).toBe(
      '$Sta/Password=[password removed]\n$AP/Password =[password removed]\r\n[esp101][password removed]\n[ESP106][password removed]',
    );
  });

  it.each(['$ESP101=', '$esp106=', '[Sta/Password]', '[ap/password]'])(
    'masks both FluidNC spellings and syntaxes: %s',
    (prefix) => {
      const masked = `${prefix}[password removed]`;
      expect(maskControllerPasswords(`${prefix}Synthetic Secret\r\n$100=80`)).toBe(
        `${masked}\r\n$100=80`,
      );
      expect(maskControllerPasswords(`${masked}\\nSyntheticTail`)).toBe(masked);
      expect(maskControllerPasswords(`${masked}SyntheticTail`)).toBe(masked);
      expect(maskControllerPasswords(prefix)).toBe(masked);
    },
  );

  it('leaves other settings alone and is idempotent on its own output', () => {
    for (const text of [
      '$7500=1',
      '$07500=1',
      '$03310=1',
      '$75 00=1',
      '$0331 0=1',
      '$5330suffix=1',
      '$1075=1',
      '$74=MyNetwork',
      '$76=MyAccessPoint',
      '$329=visible',
      '$532=visible',
      '$534=visible',
      '$532=mqtt-user',
      '$330',
      '$ESP100=VisibleSSID',
      '$ESP105=VisibleAP',
      '$ESP1010=visible',
      '[Sta/SSID]VisibleSSID',
      '[ESP100]VisibleSSID',
      '[Sta/PasswordExtra]visible',
    ]) {
      expect(maskControllerPasswords(text)).toBe(text);
    }
    const once = maskControllerPasswords('$77=apSecret77');
    expect(maskControllerPasswords(once)).toBe(once);
    expect(maskControllerPasswords(`${once}\\nSyntheticTail`)).toBe(once);
  });
});
