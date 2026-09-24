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
  const vendor = usbIdHex(port.vendorId);
  const product = usbIdHex(port.productId);
  const usb = vendor !== undefined && product !== undefined ? ` - USB ${vendor}:${product}` : '';
  return port.displayName !== undefined ? `${name} - ${port.portName}${usb}` : `${name}${usb}`;
}

// Electron reports USB IDs as decimal strings ('6790' for a CH340's 0x1A86).
// Device Manager, vendor documents and the browser build all show them as four
// hex digits, so the picker does too (controller audit electron-native-4).
function usbIdHex(value: string | undefined): string | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const id = Number(value);
  return id <= 0xffff ? id.toString(16).padStart(4, '0') : undefined;
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
