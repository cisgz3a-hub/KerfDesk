import { useLaserStore } from '../state/laser-store';
import { ControllerConnectionControls } from './ControllerConnectionControls';
import { WorkspaceSafetyNotice } from './WorkspaceSafetyNotice';

/** The connection controls bound to the live store, with the safety notice
 * the app floats over the canvas beside them (ADR-634). */
export function CurrentControllerControls(): JSX.Element {
  const autofocusBusy = useLaserStore((state) => state.autofocusBusy);
  const motionOperation = useLaserStore((state) => state.motionOperation);
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  return (
    <>
      <ControllerConnectionControls
        machineKind="laser"
        autofocusBusy={autofocusBusy}
        motionOperation={motionOperation}
        controllerOperation={controllerOperation}
        onForget={() => undefined}
      />
      <WorkspaceSafetyNotice />
    </>
  );
}
