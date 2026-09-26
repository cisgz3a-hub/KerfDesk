import { selectControllerDriver } from '../../core/controllers';
import type { DeviceProfile } from '../../core/devices';
import type { ConnectControllerOptions } from '../state/laser-store';

/** The profile's driver has no live transport (ADR-097: Ruida .rd export), so
 *  no Connect surface can open one for it (audit RU-6). */
export function hasFileOnlyTransport(device: DeviceProfile): boolean {
  const driver = selectControllerDriver(device.controllerKind, device.controllerCommandSet);
  return driver.capabilities.transport === 'file-only';
}

// The menu Connect command must open the transport with the SAME controller
// driver and baud the rail's Connect uses. A bare connect() resolves to the
// GRBL driver at 115200, so a Marlin / Smoothieware / custom-baud / file-only
// profile connects with the wrong protocol and GRBL-only realtime semantics
// (ADR-095 — pause/stop bytes those firmwares ignore appear available). Derive
// the connect options from the configured device profile so both Connect
// surfaces agree.
export function connectOptionsForDevice(device: DeviceProfile): ConnectControllerOptions {
  return {
    controllerKind: device.controllerKind,
    baudRate: device.baudRate,
    ...(device.controllerCommandSet === undefined
      ? {}
      : { controllerCommandSet: device.controllerCommandSet }),
    ...(typeof device.workerHostedStreaming === 'boolean'
      ? { hostedStreaming: device.workerHostedStreaming }
      : {}),
  };
}
