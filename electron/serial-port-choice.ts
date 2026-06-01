export type ElectronSerialPortSummary = {
  readonly portId: string;
  readonly portName: string;
  readonly displayName?: string;
  readonly vendorId?: string;
  readonly productId?: string;
};

const CANCEL_BUTTON = 'Cancel';

export function serialPortLabel(port: ElectronSerialPortSummary): string {
  const name = port.displayName ?? port.portName;
  const usb =
    port.vendorId !== undefined && port.productId !== undefined
      ? ` - USB ${port.vendorId}:${port.productId}`
      : '';
  return port.displayName !== undefined ? `${name} - ${port.portName}${usb}` : `${name}${usb}`;
}

export function serialPortDialogButtons(
  ports: ReadonlyArray<ElectronSerialPortSummary>,
): ReadonlyArray<string> {
  return [...ports.map(serialPortLabel), CANCEL_BUTTON];
}

export function serialPortIdForDialogResponse(
  ports: ReadonlyArray<ElectronSerialPortSummary>,
  response: number,
): string {
  return ports[response]?.portId ?? '';
}
