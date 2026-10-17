import { rotaryAppliesTo } from '../../core/job/rotary-job';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { selectedObjectIds } from '../state/scene-group-actions';
import { headMoveBlockMessage } from './head-move-dispatch';
import { moveLaserToSelection } from './move-laser-to-selection';

export function CentreSelectionButton({ disabled }: { readonly disabled: boolean }): JSX.Element {
  const hasSelection = useStore((state) => {
    const selected = new Set(selectedObjectIds(state));
    return state.project.scene.objects.some((object) => selected.has(object.id));
  });
  const absolute = useStore((state) => state.jobPlacement.startFrom === 'absolute');
  const rotary = useStore((state) => rotaryAppliesTo(state.project.device, state.project.machine));
  const machineBlocked = useLaserStore((state) => headMoveBlockMessage(state));
  const blocked = !hasSelection
    ? 'Select a trace or other artwork to centre the head on.'
    : !absolute
      ? 'Centre selection needs Absolute Coords. Use Frame to locate artwork placed from an origin.'
      : (machineBlocked ?? (disabled ? 'Wait for the current machine operation to finish.' : null));
  return (
    <button
      type="button"
      className="lf-btn"
      aria-label="Centre selection"
      title={
        blocked ??
        (rotary
          ? 'Move the head to the X centre of the selection bounds with the beam off. The rotary keeps its current Y.'
          : 'Move the head to the centre of the selection bounds with the beam off, using Absolute Coords.')
      }
      disabled={blocked !== null}
      onClick={() => moveLaserToSelection('c')}
    >
      Centre selection
    </button>
  );
}
