import { selectControllerDriver } from '../../core/controllers';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { usbIdLabel } from '../state/serial-port-memory';

// The machine line inside the connection card (ADR-420). Connected, it names
// the driver the live session actually uses, which a later profile save does
// not reselect; disconnected, it names what Connect will use.
export function ConnectedMachineProfile(): JSX.Element {
  const connected = useLaserStore((state) => state.connection.kind === 'connected');
  const controllerKind = useLaserStore((state) => state.activeControllerKind);
  const commandSet = useLaserStore((state) => state.activeControllerCommandSet);
  const portInfo = useLaserStore((state) => state.serialPortInfo ?? null);
  const baudRate = useLaserStore((state) => state.connectedBaudRate ?? null);
  const device = useStore((state) => state.project.device);
  const driver = connected
    ? selectControllerDriver(controllerKind, commandSet ?? undefined)
    : selectControllerDriver(device.controllerKind, device.controllerCommandSet);
  const port = connected ? connectedPortText(usbIdLabel(portInfo), baudRate) : null;
  return (
    <div
      className="lf-connected-profile"
      aria-label={connected ? 'Connected machine profile' : 'Machine profile'}
      data-connected={connected}
    >
      <strong className="lf-connected-profile-name">{device.name || 'Unnamed machine'}</strong>
      <span className="lf-connected-profile-detail">
        {device.bedWidth} × {device.bedHeight} mm · {driver.label}
      </span>
      {port === null ? null : <span className="lf-connected-profile-port">{port}</span>}
    </div>
  );
}

function connectedPortText(usb: string | null, baudRate: number | null): string | null {
  const parts = [usb === null ? null : `USB ${usb}`, baudRate === null ? null : `${baudRate} baud`];
  const text = parts.filter((part): part is string => part !== null).join(' · ');
  return text === '' ? null : text;
}
