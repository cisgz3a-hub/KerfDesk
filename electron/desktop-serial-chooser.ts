// The desktop serial port picker (select-serial-port). Chromium hands main the
// ports it can see; main asks the operator which one to open, waiting with
// them when none is attached yet (serial-port-wait.ts). Only the picked port
// is granted (ADR-366); on Windows main also remembers it (ADR-552).

import {
  app,
  BrowserWindow,
  dialog,
  type Event as ElectronEvent,
  type WebContents,
} from 'electron';
import {
  serialPortDialogButtons,
  serialPortIdForDialogResponse,
  serialPortLabel,
  type ElectronSerialPortSummary,
} from './serial-port-choice.js';
import {
  serialPortDiscoveryDiagnostic,
  serialPortSelectionDiagnostic,
  type SerialDiagnosticPolicy,
} from './serial-port-diagnostics.js';
import {
  waitForSerialPorts,
  type NoPortsPrompt,
  type SerialPortEventSource,
} from './serial-port-wait.js';

export type ElectronSerialPort = ElectronSerialPortSummary & {
  readonly vendorId?: string;
  readonly productId?: string;
  readonly serialNumber?: string;
  readonly usbDriverName?: string;
  readonly deviceInstanceId?: string;
};

/** Where picks are remembered across restarts (ADR-552); absent where they are not. */
export type SerialPortMemory = {
  readonly recordPick: (port: ElectronSerialPort) => void;
  readonly preferredIndex: (ports: ReadonlyArray<ElectronSerialPort>) => number;
};

async function chooseSerialPortId(
  webContents: WebContents,
  portList: ReadonlyArray<ElectronSerialPort>,
  memory: SerialPortMemory | undefined,
): Promise<string> {
  const owner = BrowserWindow.fromWebContents(webContents) ?? undefined;
  const showMessageBox: NoPortsPrompt = (options) =>
    owner === undefined ? dialog.showMessageBox(options) : dialog.showMessageBox(owner, options);
  // An empty list waits with the operator for a port (serial-port-wait.ts).
  // Ports that arrive while waiting are the same Electron SerialPort objects.
  const ports: ReadonlyArray<ElectronSerialPort> =
    portList.length > 0
      ? portList
      : await waitForSerialPorts(
          webContents.session as unknown as SerialPortEventSource,
          webContents,
          showMessageBox,
        );
  if (ports.length === 0) {
    console.log('[serial] No ports - is the laser plugged in and powered on?');
    return '';
  }
  const buttons = serialPortDialogButtons(ports);
  const options = {
    type: 'question' as const,
    buttons: [...buttons],
    cancelId: buttons.length - 1,
    defaultId: memory?.preferredIndex(ports) ?? 0,
    noLink: true,
    message: 'Select laser serial port',
    detail: ports.map((port, i) => `${i + 1}. ${serialPortLabel(port)}`).join('\n'),
  };
  const result = await showMessageBox(options);
  const chosen = serialPortIdForDialogResponse(ports, result.response);
  // Recorded before Chromium hears the answer: with remembered ports, this
  // record is the grant the window's open is checked against.
  const picked = ports.find((port) => port.portId === chosen);
  if (picked !== undefined) memory?.recordPick(picked);
  return chosen;
}

function logSerialPorts(portList: ReadonlyArray<ElectronSerialPort>): void {
  console.log(...serialPortDiscoveryDiagnostic(portList, serialDiagnosticPolicy()));
}

function serialDiagnosticPolicy(): SerialDiagnosticPolicy {
  return {
    isPackaged: app.isPackaged,
    detailedOptIn: process.env.KERFDESK_DETAILED_SERIAL_DIAGNOSTICS === '1',
  };
}

export function handleSelectSerialPort(
  event: ElectronEvent,
  portList: ReadonlyArray<ElectronSerialPort>,
  webContents: WebContents,
  callback: (portId: string) => void,
  memory?: SerialPortMemory,
): void {
  event.preventDefault();
  logSerialPorts(portList);
  void chooseSerialPortId(webContents, portList, memory)
    .then((chosen) => {
      console.log(serialPortSelectionDiagnostic(chosen, serialDiagnosticPolicy()));
      callback(chosen);
    })
    .catch((err: unknown) => {
      console.error('Serial port picker failed:', err);
      callback('');
    });
}
