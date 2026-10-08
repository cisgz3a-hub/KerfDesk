// The text of Help > Save Support Report (ADR-546): what KerfDesk support
// needs to see what went wrong, in a plain file the customer reads before
// sending. It holds no licence key, payment order or password. This module
// only formats; save-support-report.ts gathers the facts.

import type { ControllerKind } from '../../core/devices';
import type { MachineKind } from '../../core/scene';
import type { LicenceStatus } from '../../platform/types';
import type { EditionValue } from '../licensing/edition';
import type { RendererProblem } from './renderer-problems';
import type { SerialTranscriptEntry } from '../state/laser-transcript';
import { incidentReportLines } from './support-report-incidents';
import { redactSupportReportText } from './support-report-redaction';

export type DesktopLogFact =
  | { readonly kind: 'none' }
  | { readonly kind: 'read'; readonly text: string }
  | { readonly kind: 'failed'; readonly message: string };

export type SupportReportFacts = {
  readonly savedAt: Date;
  readonly build: { readonly version: string; readonly commit: string; readonly builtAt: string };
  readonly app: 'web' | 'electron' | 'mock';
  readonly edition: string;
  readonly system: {
    readonly userAgent: string;
    readonly languages: ReadonlyArray<string>;
    readonly screen: string;
    readonly online: boolean;
  };
  readonly machine: ReadonlyArray<string>;
  readonly machineSettings: {
    readonly readAt: number | null;
    readonly lines: ReadonlyArray<string>;
  };
  readonly machineConsole: ReadonlyArray<string>;
  readonly controllerIncidents?: ReadonlyArray<SerialTranscriptEntry>;
  readonly problems: ReadonlyArray<RendererProblem>;
  readonly desktopLog: DesktopLogFact;
};

export function formatSupportReport(facts: SupportReportFacts): string {
  const sections = [
    [
      'KerfDesk support report',
      `Saved ${facts.savedAt.toISOString()}`,
      '',
      'This file helps KerfDesk support see what went wrong. It holds no licence key,',
      'password or payment details. Read it before you send it, and delete anything',
      'you would rather not share.',
    ],
    section('KerfDesk', [
      `Version: ${facts.build.version} (commit ${facts.build.commit}, built ${facts.build.builtAt})`,
      `App: ${facts.app === 'electron' ? 'desktop app' : 'web app'}`,
      `Edition: ${facts.edition}`,
    ]),
    section('Computer', [
      `Browser: ${facts.system.userAgent}`,
      `Languages: ${facts.system.languages.join(', ') || 'not reported'}`,
      `Screen: ${facts.system.screen}`,
      `Online: ${facts.system.online ? 'yes' : 'no'}`,
    ]),
    section('Machine', facts.machine),
    section(settingsTitle(facts.machineSettings.readAt), facts.machineSettings.lines, 'Not read.'),
    section('Machine console, newest last', facts.machineConsole, 'Empty.'),
    section(
      'Retained controller incidents, newest last',
      incidentReportLines(facts.controllerIncidents ?? []),
      'None.',
    ),
    section('Problems in this window, newest last', facts.problems.map(problemLines), 'None.'),
    ...(facts.app === 'electron' ? [section('Desktop log, newest last', logLines(facts))] : []),
  ];
  const text = `${sections.map((lines) => lines.join('\n')).join('\n\n')}\n`;
  return redactSupportReportText(text);
}

function section(
  title: string,
  lines: ReadonlyArray<string>,
  empty = 'Nothing to show.',
): ReadonlyArray<string> {
  return [`== ${title} ==`, ...(lines.length === 0 ? [empty] : lines)];
}

function settingsTitle(readAt: number | null): string {
  return readAt === null
    ? 'Machine settings ($$)'
    : `Machine settings ($$), read ${new Date(readAt).toISOString()}`;
}

function problemLines(problem: RendererProblem): string {
  return `${new Date(problem.at).toISOString()} ${problem.kind}: ${problem.message}`;
}

function logLines(facts: SupportReportFacts): ReadonlyArray<string> {
  const log = facts.desktopLog;
  if (log.kind === 'failed') return [`Could not be read: ${log.message}`];
  if (log.kind === 'none') return ['Not available in this window.'];
  return log.text.split('\n').filter((line) => line !== '');
}

/** The edition this copy runs as, in the words the Licence panel uses. */
export function describeEdition(edition: EditionValue): string {
  const status = edition.status;
  if (edition.proInDesktop === true) return 'KerfDesk Free (Pro is in the desktop app)';
  if (status === null) return edition.pro ? 'Every tool (sales have not opened)' : 'KerfDesk Free';
  if (status.channel === 'free')
    return edition.pro
      ? 'Every tool (a desktop build without licensing)'
      : 'KerfDesk Free (a desktop build without licensing)';
  const details = [...licenceDates(status), ...licenceFlags(status)];
  const name = editionName(status);
  return details.length === 0 ? name : `${name}: ${details.join(', ')}`;
}

function editionName(status: LicenceStatus): string {
  if (status.edition === 'free') return 'KerfDesk Free';
  if (status.tier === 'trial') return 'KerfDesk Pro trial';
  return status.tier === 'developer' ? 'KerfDesk Pro (developer licence)' : 'KerfDesk Pro';
}

function licenceDates(status: LicenceStatus): ReadonlyArray<string> {
  const ends = status.tier === 'trial' ? 'trial ends' : 'access ends';
  return [
    ...(status.accessExpiresAt === null ? [] : [`${ends} ${day(status.accessExpiresAt)}`]),
    ...(status.perpetualUpdates ? ['updates for every version'] : []),
    ...(status.updatesUntil === null || status.perpetualUpdates
      ? []
      : [`updates until ${day(status.updatesUntil)}`]),
  ];
}

function licenceFlags(status: LicenceStatus): ReadonlyArray<string> {
  return [
    ...(status.state === 'ready' ? [] : [`licence state ${status.state}`]),
    ...(status.storeUnreadable ? ['saved licence unreadable'] : []),
    ...(status.deactivationPending ? ['deactivation pending'] : []),
    ...(status.paymentPending ? ['payment pending'] : []),
    ...(status.message === null ? [] : [`message "${status.message}"`]),
  ];
}

function day(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export type MachineReportInput = {
  readonly device: {
    readonly name: string;
    readonly vendor?: string;
    readonly model?: string;
    readonly controllerKind?: ControllerKind;
    readonly bedWidth: number;
    readonly bedHeight: number;
    readonly baudRate?: number;
  };
  readonly machineKind: MachineKind;
  readonly connection: { readonly kind: string; readonly error?: string };
  readonly usb: { readonly usbVendorId?: number; readonly usbProductId?: number } | null;
  readonly detectedController: ControllerKind | null;
  readonly qualification: string;
  readonly state: string | null;
  readonly alarmCode: number | null;
  readonly lastError: number | null;
  readonly resetRequired: boolean;
  readonly machinePosition: Xyz | null;
  readonly workPosition: Xyz | null;
  readonly workOrigin: string;
  readonly homing: string;
  readonly jobRunning: boolean;
  readonly firmwareLines: ReadonlyArray<string>;
};

type Xyz = { readonly x: number; readonly y: number; readonly z: number };

export function machineReportLines(input: MachineReportInput): ReadonlyArray<string> {
  return [
    `Profile: ${profileLine(input)}`,
    `Connection: ${connectionLine(input)}`,
    `Controller: ${input.detectedController ?? 'not identified yet'}, ${input.qualification}`,
    `State: ${stateLine(input)}`,
    ...(input.machinePosition === null && input.workPosition === null
      ? []
      : [`Position: machine ${xyz(input.machinePosition)}, work ${xyz(input.workPosition)}`]),
    `Origin: ${input.workOrigin}; homing ${input.homing}`,
    `Job: ${input.jobRunning ? 'running' : 'none running'}`,
    ...(input.firmwareLines.length === 0 ? [] : [`Firmware: ${input.firmwareLines.join(' ')}`]),
  ];
}

function profileLine(input: MachineReportInput): string {
  const { device } = input;
  const maker = [device.vendor, device.model].filter((part) => part !== undefined && part !== '');
  const kind = input.machineKind === 'cnc' ? 'CNC router' : 'laser';
  const baud = device.baudRate === undefined ? '' : `, ${device.baudRate} baud`;
  return [
    `${device.name}${maker.length === 0 ? '' : ` (${maker.join(' ')})`}, ${kind}`,
    `${device.controllerKind ?? 'grbl-v1.1'}, bed ${device.bedWidth} × ${device.bedHeight} mm${baud}`,
  ].join(', ');
}

function connectionLine(input: MachineReportInput): string {
  const text =
    input.connection.error === undefined
      ? input.connection.kind
      : `${input.connection.kind}: ${input.connection.error}`;
  const { usbVendorId, usbProductId } = input.usb ?? {};
  return usbVendorId === undefined || usbProductId === undefined
    ? text
    : `${text} (USB ${hex(usbVendorId)}:${hex(usbProductId)})`;
}

function stateLine(input: MachineReportInput): string {
  return [
    input.state ?? 'no status report yet',
    ...(input.alarmCode === null ? [] : [`alarm ${input.alarmCode}`]),
    ...(input.lastError === null ? [] : [`last error ${input.lastError}`]),
    ...(input.resetRequired ? ['reset required'] : []),
  ].join(', ');
}

function xyz(position: Xyz | null): string {
  if (position === null) return 'unknown';
  return `X${position.x.toFixed(3)} Y${position.y.toFixed(3)} Z${position.z.toFixed(3)}`;
}

function hex(id: number): string {
  return id.toString(16).padStart(4, '0');
}
