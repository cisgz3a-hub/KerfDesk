import { selectControllerDriver } from '../../core/controllers';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';

export function ConnectedMachineProfile(): JSX.Element | null {
  const connected = useLaserStore((state) => state.connection.kind === 'connected');
  const controllerKind = useLaserStore((state) => state.activeControllerKind);
  const commandSet = useLaserStore((state) => state.activeControllerCommandSet);
  const device = useStore((state) => state.project.device);
  if (!connected) return null;

  return (
    <section className="lf-connected-profile" aria-label="Connected machine profile">
      <span className="lf-connected-profile-label">Connected · Active profile</span>
      <strong className="lf-connected-profile-name">{device.name || 'Unnamed machine'}</strong>
      <span className="lf-connected-profile-detail">
        {device.bedWidth} × {device.bedHeight} mm ·{' '}
        {selectControllerDriver(controllerKind, commandSet ?? undefined).label}
      </span>
    </section>
  );
}
