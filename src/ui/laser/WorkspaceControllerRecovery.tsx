// ADR-642: a controller that stopped answering opens its recovery card over the
// canvas by itself, under the safety notice (ADR-634). It used to wait behind a
// six-second line beside the Laser/CNC switch, so a paused job showed the
// safety notice while Retry and Reconnect, which fix the cause, stayed hidden.
// Closing the card folds it into a button that stays while recovery is needed.

import { useRef, useState } from 'react';
import { usePlatform } from '../app/platform-context';
import { Icon } from '../kit/icons';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { connectionControlsBusy } from './ControllerConnectionControls';
import { ControllerRecoveryToast } from './ControllerRecoveryToast';
import { controllerRecoveryKey } from './controller-notice';
import {
  isFileOnlyController,
  useControllerQualificationRetry,
  useControllerReconnect,
} from './controller-reconnect';
import { useControllerStoppedResponding } from './use-controller-went-silent';

export type ControllerRecovery = {
  readonly key: string;
  readonly message: string;
  readonly readBlockReason: string | null;
  readonly reconnectRecommended: boolean;
  readonly stoppedResponding: boolean;
  readonly disabled: boolean;
  readonly collapsed: boolean;
  readonly focusOnChange: boolean;
  readonly collapse: () => void;
  readonly expand: () => void;
};

/** The current recovery, or null. Collapsing applies to this failure only: a
 * new failure opens the card again. */
export function useControllerRecovery(): ControllerRecovery | null {
  const platform = usePlatform();
  const connection = useLaserStore((state) => state.connection);
  const qualification = useLaserStore((state) => state.controllerQualification);
  const reconnectRecommended = useLaserStore((state) => state.getControllerReconnectRecommended());
  const stoppedResponding = useControllerStoppedResponding(connection.kind === 'connected');
  const readBlockReason = useLaserStore((state) => state.getMachineSettingsReadBlockReason());
  const busy = useLaserStore((state) =>
    connectionControlsBusy(state.motionOperation, state.controllerOperation),
  );
  const fileOnly = useStore((state) => isFileOnlyController(state.project.device.controllerKind));
  const [folded, setFolded] = useState<{ readonly key: string | null; readonly focus: boolean }>({
    key: null,
    focus: false,
  });
  const key = controllerRecoveryKey({
    connection,
    qualification,
    stoppedResponding,
  });
  if (key === null || qualification.kind !== 'failed') return null;
  return {
    key,
    message: qualification.message,
    readBlockReason,
    reconnectRecommended,
    stoppedResponding,
    disabled: !platform.serial.isSupported() || busy || fileOnly,
    collapsed: folded.key === key,
    focusOnChange: folded.focus,
    collapse: () => setFolded({ key, focus: true }),
    expand: () => setFolded({ key: null, focus: true }),
  };
}

export function WorkspaceControllerRecovery(props: {
  readonly recovery: ControllerRecovery;
}): JSX.Element {
  const { recovery } = props;
  const closeRef = useRef<HTMLButtonElement>(null);
  const retry = useControllerQualificationRetry();
  const reconnect = useControllerReconnect();
  if (recovery.collapsed) {
    return (
      <button
        type="button"
        className="lf-btn lf-controller-recovery-pill"
        autoFocus={recovery.focusOnChange}
        onClick={recovery.expand}
        title="Show Retry and Reconnect for the controller."
      >
        <Icon name="warning" size={14} />
        {/* The card opens only for a controller that stopped answering (ADR-642). */}
        <span>Machine stopped answering</span>
        <span className="lf-controller-recovery-pill__action">Show</span>
      </button>
    );
  }
  return (
    <ControllerRecoveryToast
      closeRef={closeRef}
      onDismiss={recovery.collapse}
      focusOnOpen={recovery.focusOnChange}
      message={recovery.message}
      readBlockReason={recovery.readBlockReason}
      reconnectRecommended={recovery.reconnectRecommended}
      stoppedResponding={recovery.stoppedResponding}
      onRetry={retry}
      onReconnect={reconnect}
      disabled={recovery.disabled}
      label="Controller recovery"
      closeLabel="Collapse controller recovery"
      closeTitle="Fold this card into a button. It stays at the top of the canvas until the controller recovers."
    />
  );
}
