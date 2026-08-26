import type { ElectronSerialPortSummary } from './serial-port-choice.js';

export type SerialDiagnosticPolicy = {
  readonly isPackaged: boolean;
  readonly detailedOptIn: boolean;
};

export function serialPortDiscoveryDiagnostic(
  ports: ReadonlyArray<ElectronSerialPortSummary>,
  policy: SerialDiagnosticPolicy,
): readonly [string, unknown?] {
  const summary = `[serial] select-serial-port fired; ${ports.length} port(s) visible to OS.`;
  if (!detailedDiagnosticsEnabled(policy)) return [summary];
  return [
    summary,
    ports.map((port) => ({
      portId: port.portId,
      portName: port.portName,
      displayName: port.displayName,
      vendorId: port.vendorId,
      productId: port.productId,
    })),
  ];
}

export function serialPortSelectionDiagnostic(
  selectedPortId: string,
  policy: SerialDiagnosticPolicy,
): string {
  if (selectedPortId === '') return '[serial] Port selection cancelled.';
  return detailedDiagnosticsEnabled(policy)
    ? `[serial] Selected port: ${selectedPortId}`
    : '[serial] Serial port selected.';
}

function detailedDiagnosticsEnabled(policy: SerialDiagnosticPolicy): boolean {
  return !policy.isPackaged && policy.detailedOptIn;
}
