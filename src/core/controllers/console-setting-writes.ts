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
// check the Machine Settings dialog applies (grbl-setting-storage.ts). grblHAL
// refuses a fraction or an out-of-range value itself (error:2 or error:52), so
// its values are left to the firmware (ADR-375, C-4).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L229
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L3548-L3559
import type { ConsoleSettingWrite, ControllerDriver } from './controller-driver';
import { stockGrblSettingStorageIssue } from './grbl/grbl-setting-storage';

type ConsoleSettingCommand = { readonly kind: string; readonly normalized: string };

const SETTING_WRITE_RE = /^\$(\d+)=(.*)$/;
const UNSIGNED_DECIMAL_RE = /^\+?(?:\d+\.?\d*|\.\d+)$/;

/** Why the Console must not send this command, or null to allow it. Only
 *  numeric `$N=` writes are judged here; every other command returns null. */
export function consoleSettingWriteIssue(
  driver: ControllerDriver,
  command: ConsoleSettingCommand,
): string | null {
  if (command.kind !== 'setting-write') return null;
  if (driver.capabilities.settings === 'grbl-dollar') {
    return driver.kind === 'grbl-v1.1' ? stockGrblValueIssue(command.normalized) : null;
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

function refusal(label: string, allowed: ReadonlyArray<ConsoleSettingWrite>): string {
  const except = allowed.length === 0 ? '' : ` other than ${listIds(allowed)}`;
  return `KerfDesk does not send numeric $ setting writes${except} on the ${label} profile. Configure the controller with its own tools.`;
}

function listIds(allowed: ReadonlyArray<ConsoleSettingWrite>): string {
  const ids = allowed.map((write) => `$${write.id}`);
  if (ids.length === 1) return ids[0] ?? '';
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1] ?? ''}`;
}
