// Which state Find my machine is in, with its heading and one-line
// explanation (ADR-420). Derived from the live connection each render; the
// only local choice is "Set up without connecting".

import { assertNever } from '../../../core/scene';
import type { ConnectionState } from '../../state/laser-store';
import type { ControllerQualification } from '../../state/laser-controller-qualification';
import { usbIdLabel } from '../../state/serial-port-memory';
import { connectionFailureText } from '../ConnectionBar';
import type { BaudScanStatus } from './use-find-machine';

export type FindMachinePhaseKind =
  | 'unsupported'
  | 'file-only'
  | 'idle'
  | 'offline'
  | 'connecting'
  | 'reading'
  | 'scanning'
  | 'silent'
  | 'found'
  | 'failed';

export type FindMachinePhase = {
  readonly kind: FindMachinePhaseKind;
  readonly title: string;
  readonly detail: string;
};

export type FindMachineFacts = {
  readonly supportsSerial: boolean;
  readonly transport: 'serial' | 'file-only';
  readonly controllerLabel: string;
  readonly fileOnlyExplanation: string;
  readonly baudRate: number;
  readonly connection: ConnectionState;
  readonly qualification: ControllerQualification;
  readonly heardController: boolean;
  readonly detectedLabel: string | null;
  readonly portUsb: string | null;
  readonly connectedBaudRate: number | null;
  readonly scan: BaudScanStatus;
};

export function findMachinePhase(
  model: {
    readonly supportsSerial: boolean;
    readonly driver: { readonly capabilities: { readonly transport: 'serial' | 'file-only' } };
    readonly guide: { readonly label: string; readonly writeExplanation: string };
    readonly baudRate: number;
    readonly laser: {
      readonly connection: ConnectionState;
      readonly qualification: ControllerQualification;
      readonly statusReport: unknown;
      readonly detectedControllerKind: string | null;
      readonly serialPortInfo: Parameters<typeof usbIdLabel>[0];
      readonly connectedBaudRate: number | null;
    };
    readonly scan: { readonly status: BaudScanStatus };
  },
  offline: boolean,
): FindMachinePhase {
  const { laser } = model;
  return phaseFromFacts(
    {
      supportsSerial: model.supportsSerial,
      transport: model.driver.capabilities.transport,
      controllerLabel: model.guide.label,
      fileOnlyExplanation: model.guide.writeExplanation,
      baudRate: model.baudRate,
      connection: laser.connection,
      qualification: laser.qualification,
      heardController: laser.statusReport !== null || laser.detectedControllerKind !== null,
      detectedLabel: laser.detectedControllerKind,
      portUsb: usbIdLabel(laser.serialPortInfo),
      connectedBaudRate: laser.connectedBaudRate,
      scan: model.scan.status,
    },
    offline,
  );
}

export function phaseFromFacts(facts: FindMachineFacts, offline: boolean): FindMachinePhase {
  if (facts.transport === 'file-only') {
    return phase(
      'file-only',
      `${facts.controllerLabel} jobs are saved as files`,
      facts.fileOnlyExplanation,
    );
  }
  if (facts.scan.kind === 'running') {
    return phase(
      'scanning',
      'Trying other speeds…',
      `Listening at ${facts.scan.baudRate} baud (${facts.scan.index} of ${facts.scan.of}). Nothing moves while KerfDesk listens.`,
    );
  }
  switch (facts.connection.kind) {
    case 'connecting':
      return phase(
        'connecting',
        'Connecting…',
        'If your browser asks, choose the port your machine is on.',
      );
    case 'failed':
      return phase(
        'failed',
        'Couldn’t connect',
        connectionFailureText(facts.connection.error, 'machine'),
      );
    case 'connected':
      return connectedPhase(facts);
    case 'disconnected':
      return disconnectedPhase(facts, offline);
    default:
      return assertNever(facts.connection);
  }
}

function disconnectedPhase(facts: FindMachineFacts, offline: boolean): FindMachinePhase {
  if (!facts.supportsSerial) {
    return phase(
      'unsupported',
      'This browser can’t reach USB machines',
      'Use Chrome or Edge, or the KerfDesk desktop app, to find the machine. You can still set it up below without connecting.',
    );
  }
  if (facts.scan.kind === 'none') {
    return phase(
      'failed',
      'No answer at any common speed',
      `Tried ${facts.scan.tried.join(', ')} baud. Check the USB cable and that the machine is switched on, or choose a different port.`,
    );
  }
  if (offline) {
    return phase(
      'offline',
      'Setting up without connecting',
      'Choose the machine type and a profile below, or enter your own values. You can find the machine at any time.',
    );
  }
  return phase(
    'idle',
    'Find your machine',
    'Plug it in by USB and switch it on. KerfDesk reads its firmware, work area, speed and power range and fills them in for you. Nothing moves, and no controller setting is changed.',
  );
}

function connectedPhase(facts: FindMachineFacts): FindMachinePhase {
  const where = portText(facts.portUsb, facts.connectedBaudRate);
  if (facts.qualification.kind === 'failed' && !facts.heardController) {
    return phase(
      'silent',
      'Your machine didn’t answer',
      `Nothing came back at ${facts.connectedBaudRate ?? facts.baudRate} baud. The controller may use another speed, or this port belongs to another device.`,
    );
  }
  if (facts.qualification.kind === 'qualifying') {
    return phase(
      'reading',
      facts.heardController ? 'Reading your controller…' : 'Waiting for the controller…',
      `Connected${where}. Reading its identity and settings; nothing moves.`,
    );
  }
  const firmware =
    facts.detectedLabel === null ? facts.controllerLabel : firmwareLabel(facts.detectedLabel);
  return phase('found', `Found your ${firmware} controller`, `Connected${where}.`);
}

function portText(usb: string | null, baudRate: number | null): string {
  const parts = [
    usb === null ? null : `on USB ${usb}`,
    baudRate === null ? null : `at ${baudRate} baud`,
  ];
  const text = parts.filter((part): part is string => part !== null).join(' ');
  return text === '' ? '' : ` ${text}`;
}

function firmwareLabel(kind: string): string {
  if (kind === 'grblhal') return 'grblHAL';
  if (kind === 'grbl-v1.1') return 'GRBL';
  if (kind === 'fluidnc') return 'FluidNC';
  if (kind === 'marlin') return 'Marlin';
  if (kind === 'smoothieware') return 'Smoothieware';
  return kind;
}

function phase(kind: FindMachinePhaseKind, title: string, detail: string): FindMachinePhase {
  return { kind, title, detail };
}
