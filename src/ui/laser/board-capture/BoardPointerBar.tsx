// BoardPointerBar — the positioning light while capturing a board (ADR-636):
// whether the red dot / crosshair is on, a switch for it, and the choice to
// switch it on automatically. While the light is on, captures and corner
// checks use the light's spot (its Machine Setup offset is compensated).
// Machines without a configured light see a one-line route to set one up.

import { positioningLightSupported } from '../../../core/devices/positioning-light';
import { machineKindOf } from '../../../core/scene';
import { useStore } from '../../state';
import { openMachineSetup } from '../device-setup/machine-setup-dialog-store';
import type { BoardPointer } from './use-board-pointer';

export function BoardPointerBar(props: {
  readonly pointer: BoardPointer;
  readonly connected: boolean;
}): JSX.Element | null {
  const device = useStore((state) => state.project.device);
  const laserMode = useStore((state) => machineKindOf(state.project.machine) === 'laser');
  const { pointer } = props;
  if (!laserMode || !positioningLightSupported(device.gcodeDialect?.dialectId)) return null;
  if (device.controllerKind === 'ruida') return null;
  if (!pointer.configured) {
    return (
      <p className="lf-place-board__muted">
        Machine has a red-dot pointer?{' '}
        <button
          type="button"
          className="lf-place-board__link"
          title="Open Machine Setup to configure the positioning light and its offset"
          onClick={() =>
            openMachineSetup({ kind: 'step', step: 'options', highlight: 'positioning-light' })
          }
        >
          Set it up
        </button>{' '}
        to aim with it while capturing.
      </p>
    );
  }
  return (
    <div className="lf-place-board__pointer" role="group" aria-label="Pointer">
      <div className="lf-place-board__pointer-status">
        <span
          className="lf-place-board__pointer-dot"
          data-on={pointer.enabled}
          aria-hidden="true"
        />
        <span role="status">{pointerStatus(pointer)}</span>
        <button
          type="button"
          className="lf-btn lf-btn--sm"
          aria-pressed={pointer.enabled}
          disabled={!props.connected || pointer.switching}
          title={
            pointer.enabled
              ? 'Switch the positioning light off; captures then use the laser head position.'
              : 'Switch the positioning light on and aim with it. The cutting beam stays off.'
          }
          onClick={pointer.toggle}
        >
          {pointer.enabled ? 'Pointer off' : 'Pointer on'}
        </button>
      </div>
      <label>
        <input
          type="checkbox"
          title="Switch the pointer on while Place Board has a board to capture, and off when the board is created or Place Board closes"
          checked={pointer.auto}
          onChange={(event) => pointer.setAuto(event.target.checked)}
        />
        Switch on automatically while capturing
      </label>
      {pointer.error !== null && (
        <p role="alert" className="lf-place-board__message lf-place-board__message--error">
          {pointer.error}
        </p>
      )}
    </div>
  );
}

function pointerStatus(pointer: BoardPointer): string {
  if (pointer.switching) return 'Switching the pointer…';
  if (!pointer.enabled) return 'Pointer off — aiming with the laser head';
  const { x, y } = pointer.offset;
  return Math.hypot(x, y) < 0.05
    ? 'Pointer on — aim the red dot at each point'
    : 'Pointer on — aim the red dot; its offset is allowed for';
}
