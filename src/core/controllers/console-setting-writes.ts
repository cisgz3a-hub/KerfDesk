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
import type { ConsoleSettingWrite, ControllerDriver } from './controller-driver';

type ConsoleSettingCommand = { readonly kind: string; readonly normalized: string };

const SETTING_WRITE_RE = /^\$(\d+)=(.*)$/;

/** Why the Console must not send this command, or null to allow it. Only
 *  numeric `$N=` writes are judged here; every other command returns null. */
export function consoleSettingWriteIssue(
  driver: ControllerDriver,
  command: ConsoleSettingCommand,
): string | null {
  if (command.kind !== 'setting-write' || driver.capabilities.settings === 'grbl-dollar') {
    return null;
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

function refusal(label: string, allowed: ReadonlyArray<ConsoleSettingWrite>): string {
  const except = allowed.length === 0 ? '' : ` other than ${listIds(allowed)}`;
  return `KerfDesk does not send numeric $ setting writes${except} on the ${label} profile. Configure the controller with its own tools.`;
}

function listIds(allowed: ReadonlyArray<ConsoleSettingWrite>): string {
  const ids = allowed.map((write) => `$${write.id}`);
  if (ids.length === 1) return ids[0] ?? '';
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1] ?? ''}`;
}
