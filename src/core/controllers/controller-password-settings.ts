// Controller settings whose value is a password (controller audit v2 C5-P2-1
// and C4-P3-7; rolling audit v2 27-P2-3 covers the support report).
//
// grblHAL prints a Format_Password setting in plain text in every `$$` reply
// unless a WebUI client is connected (core settings.c setting_get_value). Its
// password settings are core settings.h's $75 Wi-Fi station, $77 access point,
// $330 WebUI admin, $331 WebUI user and $533 MQTT broker. Only the Wi-Fi
// drivers (wifi.c, esp_at.c), the WebUI plugin (login.c) and the Ethernet
// drivers (enet.c) declare a Format_Password setting, and only these five.
// FluidNC accepts both names (Sta/Password, AP/Password) and compatibility
// aliases (ESP101, ESP106), in either $key=value or [key]value syntax.
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.c#L1961-L1962
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.h#L131-L133
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.h#L199-L200
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.h#L372
// https://github.com/bdring/FluidNC/blob/6735500abb71be33c09a3f202d66ad5fc9499063/FluidNC/src/WebUI/WifiConfig.cpp#L691-L702

export const GRBLHAL_PASSWORD_SETTING_IDS: ReadonlyArray<number> = [75, 77, 330, 331, 533];

export const CONTROLLER_PASSWORD_REMOVED = '[password removed]';

export function isGrblhalPasswordSetting(id: number): boolean {
  return GRBLHAL_PASSWORD_SETTING_IDS.includes(id);
}

export const CONTROLLER_PASSWORD_HIDDEN = '[password hidden]';

/** The value a screen shows for setting `id`: a password stays hidden, in the
 *  settings table and in a snapshot saved before snapshots dropped them. Only
 *  an exported backup keeps it, so a restore can write it back. */
export function shownControllerSettingValue(id: number, rawValue: string): string {
  return isGrblhalPasswordSetting(id) && rawValue.trim() !== ''
    ? CONTROLLER_PASSWORD_HIDDEN
    : rawValue;
}

// grblHAL reads a numeric prefix, tolerates a fraction below 0.001, and casts
// to float32 before selecting the setting. A decimal just below an integer can
// therefore select that integer's password (for example 74.999999 selects 75).
// For these IDs below 1000, 0.002 deliberately covers the fraction tolerance
// and float32 rounding in either direction. This is conservative redaction,
// not command validation: ordinary neighboring integer IDs remain visible.
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/system.c#L1203-L1213
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/nuts_bolts.c#L249-L317
const PASSWORD_ALIAS_MARGIN = 0.002;
const FLUIDNC_PASSWORD_MARKERS = ['[ESP101]', '[ESP106]', '[STA/PASSWORD]', '[AP/PASSWORD]'];

type ScannedSettingKey = { readonly end: number; readonly password: boolean };

/** Replaces each password assignment's whole value, spaces included, to the
 *  end of its line: `$75=secret` becomes `$75=[password removed]`. */
export function maskControllerPasswords(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let copyFrom = 0;
  let passwordKey = false;
  while (cursor < text.length) {
    const character = text.charAt(cursor);
    if (character === '$') {
      const key = scanSettingKey(text, cursor + 1);
      passwordKey ||= key.password;
      cursor = key.end;
      continue;
    }
    if (isLineBreak(character)) {
      passwordKey = false;
      cursor += 1;
      continue;
    }
    const valueStart = passwordValueStart(text, cursor, character, passwordKey);
    if (character === '=') passwordKey = false;
    // This is raw text: even a removal-marker prefix can be part of a password.
    if (valueStart !== null) {
      const end = physicalLineEnd(text, valueStart);
      parts.push(text.slice(copyFrom, valueStart), CONTROLLER_PASSWORD_REMOVED);
      copyFrom = end;
      cursor = end;
      passwordKey = false;
    } else cursor += 1;
  }
  if (parts.length === 0) return text;
  parts.push(text.slice(copyFrom));
  return parts.join('');
}

// Prefix scans consume disjoint characters. Suffixes are visited only by the
// outer cursor, so repeated `$75x` candidates without '=' cannot rescan a line.
function scanSettingKey(text: string, start: number): ScannedSettingKey {
  const keyStart = skipHorizontalBlanks(text, start);
  const numberStart =
    text.charAt(keyStart) === '+' ? skipHorizontalBlanks(text, keyStart + 1) : keyStart;
  const character = text.charAt(numberStart);
  return isDecimalDigit(character) || character === '.'
    ? scanNumericKey(text, numberStart)
    : scanNamedKey(text, keyStart);
}

function scanNumericKey(text: string, start: number): ScannedSettingKey {
  let end = start;
  let word = '';
  let decimal = false;
  while (end < text.length) {
    const character = text.charAt(end);
    if (isHorizontalBlank(character)) end += 1;
    else if (isDecimalDigit(character)) {
      word += character;
      end += 1;
    } else if (character === '.' && !decimal) {
      word += character;
      decimal = true;
      end += 1;
    } else break;
  }
  const value = Number(word);
  return {
    end,
    password: GRBLHAL_PASSWORD_SETTING_IDS.some(
      (id) => Math.abs(value - id) < PASSWORD_ALIAS_MARGIN,
    ),
  };
}

function scanNamedKey(text: string, start: number): ScannedSettingKey {
  let end = start;
  while (isSettingNameCode(text.charCodeAt(end))) end += 1;
  const wordEnd = end;
  end = skipHorizontalBlanks(text, end);
  const name = text.slice(start, wordEnd).toLowerCase();
  return {
    end,
    password:
      (name.endsWith('password') || name === 'esp101' || name === 'esp106') &&
      text.charAt(end) === '=',
  };
}

function passwordValueStart(
  text: string,
  cursor: number,
  character: string,
  passwordKey: boolean,
): number | null {
  if (character === '=' && passwordKey) return cursor + 1;
  if (character !== '[') return null;
  // A fixed set of bounded-length markers keeps failed bracket candidates linear.
  const marker = FLUIDNC_PASSWORD_MARKERS.find(
    (candidate) => text.slice(cursor, cursor + candidate.length).toUpperCase() === candidate,
  );
  return marker === undefined ? null : cursor + marker.length;
}

function skipHorizontalBlanks(text: string, start: number): number {
  let end = start;
  while (isHorizontalBlank(text.charAt(end))) end += 1;
  return end;
}

function physicalLineEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && !isLineBreak(text.charAt(end))) end += 1;
  return end;
}

function isHorizontalBlank(character: string): boolean {
  return character === ' ' || character === '\t';
}

function isLineBreak(character: string): boolean {
  return character === '\r' || character === '\n';
}

function isDecimalDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

function isSettingNameCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 47
  );
}
