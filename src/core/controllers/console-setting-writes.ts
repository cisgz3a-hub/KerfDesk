// Which numeric `$N=` writes the Console sends on a controller profile.
//
// A driver whose capabilities report `settings: 'grbl-dollar'` sends any numeric
// setting (after the Console's confirmation and fresh-Idle checks). Every other
// profile refuses them: FluidNC keeps its configuration in a YAML file, and the
// Falcon A1 Pro vendor contract keeps general settings out of host software
// (audit settings-console-10). A driver may still list the few writes its
// vendor documents for console use, each with the value range the vendor
// gives. Creality's Falcon A1 parameter page says to set the air-assist
// parameters $150-$152 from a software console, and Job Review's advice for
// the A1 air pump is `$152=100`, so the Falcon contract lists those three
// (ADR-370).
//
// On stock GRBL the value is checked too: the firmware keeps its integer
// settings in 8 bits, drops the fraction and still answers `ok`, so `$22=0.5`
// stored 0 and turned homing and soft limits off. The Console now applies the
// check the Machine Settings dialog applies (grbl-setting-storage.ts) (ADR-375,
// C-4).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L229
//
// grblHAL refuses a non-zero fraction or a value outside a setting's declared
// limits itself, but it keeps every character after `=` in a `$` line and
// reads only the number at the start, so `$100=26,67` stored 26 and
// `$110=5O00` stored 5 with `ok`. Builds before 20261015 also read each zero
// after the point of a whole-number setting as one more digit: `$22=1.0`
// stored 10, which turned homing and soft limits off (controller audit v2
// C4-P2-1, ADR-375 Amendment 4). For the GRBL settings KerfDesk knows, the
// Console therefore sends only the value the Machine Settings encoder would
// send (grbl-setting-number.ts). Other grblHAL settings, strings, addresses and
// plugin settings among them, are left to the firmware; the `$$` re-read is
// compared with the typed value instead.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L1139-L1213
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L3527-L3552
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/nuts_bolts.c#L194-L244
import type { ConsoleSettingWrite, ControllerDriver } from './controller-driver';
import { GRBL_SETTING_DEFINITIONS } from './grbl/grbl-setting-definitions';
import {
  encodeGrblSettingValue,
  grblHalReadsWholeNumber,
  type EncodedGrblSettingValue,
} from './grbl/grbl-setting-number';
import { settingReadbackMatches, stockGrblSettingStorageIssue } from './grbl/grbl-setting-storage';

type ConsoleSettingCommand = { readonly kind: string; readonly normalized: string };

const SETTING_WRITE_RE = /^\$(\d+)=(.*)$/;
const UNSIGNED_DECIMAL_RE = /^\+?(?:\d+\.?\d*|\.\d+)$/;
const DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
// grblHAL keeps `$26` (homing debounce, Format_Int16) in 16 bits with no
// maximum of its own, so a larger value wraps; `$1`, its other 16-bit setting
// among these, refuses above 65535 itself.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2392
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L3590-L3592
const GRBLHAL_UNCHECKED_UINT16_IDS: ReadonlySet<number> = new Set([26]);
const UINT16_MAX = 65535;

/** Why the Console must not send this command, or null to allow it. Only
 *  numeric `$N=` writes are judged here; every other command returns null. */
export function consoleSettingWriteIssue(
  driver: ControllerDriver,
  command: ConsoleSettingCommand,
): string | null {
  if (command.kind !== 'setting-write') return null;
  if (driver.capabilities.settings === 'grbl-dollar') {
    if (driver.kind === 'grbl-v1.1') return stockGrblValueIssue(command.normalized);
    return driver.kind === 'grblhal' ? grblHalValueIssue(command.normalized) : null;
  }
  const match = SETTING_WRITE_RE.exec(command.normalized);
  const allowed = driver.consoleSettingWrites ?? [];
  const write = allowed.find((candidate) => candidate.id === Number(match?.[1]));
  if (match === null || write === undefined) return refusal(driver.label, allowed);
  const value = (match[2] ?? '').trim();
  const number = Number(value);
  if (/^\d+$/.test(value) && number >= write.min && number <= write.max) return null;
  return `$${write.id} (${write.meaning}) takes a whole number from ${write.min} to ${write.max}.`;
}

// A Console refusal of kind (a), transport: stock GRBL cannot store the value
// as typed; it would keep a different one and still answer `ok`.
function stockGrblValueIssue(normalized: string): string | null {
  const match = SETTING_WRITE_RE.exec(normalized);
  const value = match === null ? null : stockGrblSettingValue(match[2] ?? '');
  return value === null ? null : stockGrblSettingStorageIssue(Number(match?.[1]), value);
}

// The number stock GRBL reads from a `$x=` value: its line reader drops
// whitespace, control characters and '/', removes `(...)` comments and cuts a
// `;` comment, and the rest must be one unsigned decimal. Anything else, a
// negative value included, the firmware refuses itself (error:2, 3 or 4), so it
// is left to it (null).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L113-L148
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L268-L271
function stockGrblSettingValue(text: string): number | null {
  let kept = '';
  let inComment = false;
  for (const char of text) {
    if (inComment) {
      inComment = char !== ')';
      continue;
    }
    if (char === ';') break;
    if (char === '(') inComment = true;
    else if (char > ' ' && char !== '/') kept += char;
  }
  return UNSIGNED_DECIMAL_RE.test(kept) ? Number(kept) : null;
}

// A Console refusal of kind (a), transport, as on stock GRBL: grblHAL would
// keep a different value than the one typed and still answer `ok`.
function grblHalValueIssue(normalized: string): string | null {
  const match = SETTING_WRITE_RE.exec(normalized);
  const id = Number(match?.[1]);
  if (match === null || !GRBL_SETTING_DEFINITIONS.has(id)) return null;
  const typed = match[2] ?? '';
  const encoded = encodeGrblSettingValue(id, typed, 'grblhal');
  if (encoded.kind === 'blocked') return grblHalBlockedValue(id, typed, encoded);
  const value = Number(encoded.value);
  if (GRBLHAL_UNCHECKED_UINT16_IDS.has(id) && value > UINT16_MAX) {
    return `grblHAL stores $${id} in 16 bits, so ${typed} would be stored as ${value % (UINT16_MAX + 1)}. Enter a whole number from 0 to ${UINT16_MAX}.`;
  }
  return encoded.value === typed ? null : grblHalRewrittenValue(id, typed, encoded.value);
}

function grblHalRewrittenValue(id: number, typed: string, encoded: string): string | null {
  // The encoder also drops a `+` and leading zeros, which every build reads
  // alike, as it does `25.` and `0.0`.
  const olderBuild = grblHalReadsWholeNumber(id) ? olderGrblHalWholeNumber(typed) : null;
  if (olderBuild === Number(encoded)) return null;
  const note = /e/i.test(typed)
    ? ' grblHAL stops reading a value at its exponent.'
    : olderBuild === null
      ? ''
      : ` grblHAL builds before 20261015 read ${typed} as ${olderBuild} for this whole-number setting.`;
  return `grblHAL would not store $${id}=${typed} as typed. Send $${id}=${encoded} instead.${note}`;
}

function grblHalBlockedValue(
  id: number,
  typed: string,
  encoded: Extract<EncodedGrblSettingValue, { readonly kind: 'blocked' }>,
): string {
  // A value that is not one number but starts with one is stored in part.
  const keepsPrefix =
    !DECIMAL_RE.test(typed) && /^[+-]?\.?\d/.test(typed)
      ? ' grblHAL keeps only the number at the start of a value and still answers ok.'
      : '';
  return `$${id}=${typed} cannot be sent: ${encoded.reason}${keepsPrefix}`;
}

// grblHAL d7aaee3's read_uint, for an unsigned whole number with an optional
// point: each zero after the point multiplies the value by ten (`25.0` is 250,
// `25.` is 25). Fixed in 20261015, which KerfDesk cannot tell from a build.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/nuts_bolts.c#L194-L244
function olderGrblHalWholeNumber(typed: string): number | null {
  const match = /^\+?(\d*)\.?(0*)$/.exec(typed);
  const digits = `${match?.[1] ?? ''}${match?.[2] ?? ''}`;
  return match === null || digits === '' ? null : Number(digits);
}

/**
 * Why the `$$` re-read after an acknowledged Console `$N=` write does not show
 * the typed value, or null when it does or cannot tell (ADR-375 Amendment 4).
 * A numeric value is compared at the precision the controller printed. On
 * grblHAL a value that is not one number is a mismatch only when the setting
 * reads back as a number: a string setting reads back as its text.
 */
export function consoleSettingReadbackIssue(
  driver: Pick<ControllerDriver, 'kind'>,
  normalized: string,
  reportedRaw: string | undefined,
): string | null {
  const match = SETTING_WRITE_RE.exec(normalized);
  if (match === null || reportedRaw === undefined) return null;
  const typed = match[2] ?? '';
  const reported = reportedRaw.trim();
  const intended =
    driver.kind === 'grbl-v1.1'
      ? stockGrblSettingValue(typed)
      : DECIMAL_RE.test(typed)
        ? Number(typed)
        : null;
  if (intended !== null) {
    if (settingReadbackMatches(reported, intended)) return null;
  } else if (driver.kind !== 'grblhal' || !DECIMAL_RE.test(reported)) {
    return null;
  }
  return `The controller reports $${match[1]}=${reported} after the re-read, not ${typed}: it stored a different value. Write $${match[1]} again with the intended value.`;
}

function refusal(label: string, allowed: ReadonlyArray<ConsoleSettingWrite>): string {
  const except = allowed.length === 0 ? '' : ` other than ${listIds(allowed)}`;
  return `KerfDesk does not send numeric $ setting writes${except} on the ${label} profile. Configure the controller with its own tools.`;
}

function listIds(allowed: ReadonlyArray<ConsoleSettingWrite>): string {
  const ids = allowed.map((write) => `$${write.id}`);
  if (ids.length === 1) return ids[0] ?? '';
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1] ?? ''}`;
}
