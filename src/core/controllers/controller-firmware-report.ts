import type { ControllerDriver } from './controller-driver';
import type { ControllerKind } from '../devices/device-profile';

/** A firmware's own claims, never an app capability or physical qualification. */
export type ControllerFirmwareReport = {
  readonly controllerKind: ControllerKind;
  readonly query: string;
  readonly fields: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly reportedCapabilities: ReadonlyArray<{
    readonly name: string;
    readonly enabled: boolean;
  }>;
  readonly sessionEpoch: number;
  readonly observedAt: number;
};

export function firmwareReportQuery(driver: ControllerDriver): string | null {
  // Vendor command sets need their own documented report contract.
  if (driver.commandSet !== undefined) return null;
  switch (driver.kind) {
    case 'grbl-v1.1':
      return driver.commands.buildInfoQuery;
    case 'grblhal':
      return '$I+';
    case 'fluidnc':
      return '$I';
    case 'marlin':
    case 'smoothieware':
      return 'M115';
    case 'ruida':
      return null;
  }
}

const HAL_FIELDS = new Set([
  'AXS',
  'NEWOPT',
  'FIRMWARE',
  'DRIVER',
  'DRIVER VERSION',
  'BOARD',
  'COMPATIBILITY LEVEL',
]);
const M115_FIELDS = new Set([
  'FIRMWARE_NAME',
  'FIRMWARE_VERSION',
  'PROTOCOL_VERSION',
  'MACHINE_TYPE',
  'KINEMATICS',
  'EXTRUDER_COUNT',
  'X-FIRMWARE_BUILD_DATE',
  'X-SYSTEM_CLOCK',
  'X-AXES',
  'X-GRBL_MODE',
  'X-ARCS',
  'X-CNC',
  'X-MSD',
]);

/** Bounded allowlist: omit UUIDs, user build strings, network and configuration reports. */
export function parseFirmwareReport(
  kind: ControllerKind,
  responses: ReadonlyArray<string>,
): Pick<ControllerFirmwareReport, 'fields' | 'reportedCapabilities'> {
  if (responses.length > 256 || responses.reduce((sum, line) => sum + line.length, 0) > 32_768) {
    throw new Error('Firmware report exceeds the local review limit.');
  }
  const fields = new Map<string, string>();
  const caps = new Map<string, boolean>();
  const add = (name: string, value: string): void => addField(fields, name, value);
  for (const raw of responses) {
    const line = raw.trim();
    if (kind === 'marlin' || kind === 'smoothieware') {
      parseM115(line, add);
      if (kind === 'marlin') parseCapability(line, caps);
      continue;
    }
    parseBracket(kind, line, add);
  }
  const identity = kind === 'marlin' || kind === 'smoothieware' ? 'FIRMWARE_NAME' : 'Version';
  if (!fields.has(identity))
    throw new Error('The owned query did not return a recognised firmware identity.');
  if (fields.size > 32 || caps.size > 64)
    throw new Error('Firmware report contains too many fields.');
  return {
    fields: [...fields].map(([name, value]) => ({ name, value })),
    reportedCapabilities: [...caps].map(([name, enabled]) => ({ name, enabled })),
  };
}

function addField(fields: Map<string, string>, name: string, value: string): void {
  if (
    value.length === 0 ||
    value.length > 256 ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return;
  const previous = fields.get(name);
  if (previous !== undefined && previous !== value)
    throw new Error(`Conflicting firmware field: ${name}.`);
  fields.set(name, value);
}

function parseCapability(line: string, caps: Map<string, boolean>): void {
  const cap = /^Cap:([A-Z][A-Z0-9_]{0,63}):([01])$/.exec(line);
  if (cap === null) return;
  const name = cap[1] ?? '';
  const enabled = cap[2] === '1';
  if (caps.has(name) && caps.get(name) !== enabled)
    throw new Error('Conflicting firmware capability report.');
  caps.set(name, enabled);
}

function parseBracket(
  kind: ControllerKind,
  line: string,
  add: (name: string, value: string) => void,
): void {
  const bracket = /^\[([^:\]]+):([^\]]*)\]$/.exec(line);
  if (bracket === null) return;
  const name = bracket[1] ?? '';
  const value = bracket[2] ?? '';
  if (name === 'VER') add('Version', value.split(':')[0]?.trim() ?? '');
  if (name === 'OPT') add('Reported options', value);
  if (kind === 'grblhal' && HAL_FIELDS.has(name)) add(name, value);
  if (isFluidCluster(kind, name, value)) add('CLUSTER', value);
}

function isFluidCluster(kind: ControllerKind, name: string, value: string): boolean {
  return kind === 'fluidnc' && name === 'CLUSTER' && /^\d+$/.test(value);
}

function parseM115(line: string, add: (name: string, value: string) => void): void {
  // Smoothie separates fields with commas; Marlin uses whitespace. Values may contain spaces.
  const matches = [...line.matchAll(/(?:^|[\s,])([A-Z][A-Z0-9_-]*):/g)];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (match === undefined || match.index === undefined) continue;
    const name = match[1] ?? '';
    if (!M115_FIELDS.has(name)) continue;
    const start = match.index + match[0].length;
    const end = matches[i + 1]?.index ?? line.length;
    add(name, line.slice(start, end).replace(/[,\s]+$/, ''));
  }
}
