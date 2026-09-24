// What the desktop port picker does when Chromium enumerates no serial port
// (controller audit electron-native-1, transport-5). It used to cancel the
// request at once and print a hint to the main-process console, which a
// packaged app never shows: the renderer receives the same NotFoundError as an
// operator Cancel, so Connect looked dead with the machine unplugged, powered
// off or missing its USB-serial driver.
//
// The request now stays pending behind a message that names the usual causes.
// Electron reports ports plugged in meanwhile through the session's
// `serial-port-added` event while the `select-serial-port` callback is still
// pending, so Retry offers whatever arrived.

import type { ElectronSerialPortSummary } from './serial-port-choice.js';

export const NO_SERIAL_PORTS_MESSAGE = 'No serial ports found';

export const NO_SERIAL_PORTS_DETAIL =
  'Check the USB data cable, that the machine is powered on, and that its USB-serial driver ' +
  "(CH340 or CP210x) is installed. Help > Can't connect? (Troubleshooting) has more.\n\n" +
  'Plug in or power on the machine, then choose Retry.';

type PortEventListener = (event: unknown, port: ElectronSerialPortSummary, owner: unknown) => void;

export type SerialPortEventSource = {
  on(event: 'serial-port-added' | 'serial-port-removed', listener: PortEventListener): unknown;
  removeListener(
    event: 'serial-port-added' | 'serial-port-removed',
    listener: PortEventListener,
  ): unknown;
};

export type NoPortsPrompt = (options: {
  readonly type: 'warning' | 'question';
  readonly buttons: string[];
  readonly defaultId: number;
  readonly cancelId: number;
  readonly noLink: boolean;
  readonly message: string;
  readonly detail: string;
}) => Promise<{ readonly response: number }>;

const RETRY = 0;

/** Ports that appeared for `owner` while the operator was asked to connect
 *  one, or none when the operator cancelled. */
export async function waitForSerialPorts(
  source: SerialPortEventSource,
  owner: unknown,
  prompt: NoPortsPrompt,
): Promise<ReadonlyArray<ElectronSerialPortSummary>> {
  const ports = new Map<string, ElectronSerialPortSummary>();
  const added: PortEventListener = (_event, port, webContents) => {
    if (webContents === owner) ports.set(port.portId, port);
  };
  const removed: PortEventListener = (_event, port, webContents) => {
    if (webContents === owner) ports.delete(port.portId);
  };
  source.on('serial-port-added', added);
  source.on('serial-port-removed', removed);
  try {
    for (;;) {
      const { response } = await prompt({
        type: 'warning',
        buttons: ['Retry', 'Cancel'],
        defaultId: RETRY,
        cancelId: 1,
        noLink: true,
        message: NO_SERIAL_PORTS_MESSAGE,
        detail: NO_SERIAL_PORTS_DETAIL,
      });
      if (response !== RETRY) return [];
      if (ports.size > 0) return [...ports.values()];
    }
  } finally {
    source.removeListener('serial-port-added', added);
    source.removeListener('serial-port-removed', removed);
  }
}
