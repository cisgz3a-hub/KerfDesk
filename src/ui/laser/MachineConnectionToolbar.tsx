import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { ControllerConnectionControls } from './ControllerConnectionControls';
import { DetectedSettingsToast } from './DetectedSettingsToast';
import { confirmForgetController } from './controller-connection-actions';
import './MachineConnectionToolbar.css';

/** Machine connection stays reachable when either workspace rail is collapsed. */
export function MachineConnectionToolbar(): JSX.Element {
  const machineKind = useStore((state) => state.project.machine?.kind ?? 'laser');
  const autofocusBusy = useLaserStore((state) => state.autofocusBusy);
  const motionOperation = useLaserStore((state) => state.motionOperation);
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  return (
    <section className="lf-machine-toolbar" aria-label="Machine toolbar">
      <DetectedSettingsToast />
      <ControllerConnectionControls
        layout="compact"
        machineKind={machineKind}
        autofocusBusy={autofocusBusy}
        motionOperation={motionOperation}
        controllerOperation={controllerOperation}
        onForget={confirmForgetController}
      />
    </section>
  );
}
