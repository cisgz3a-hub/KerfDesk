import { isRegistrationLayer, type Layer } from '../../core/scene';
import { Icon } from '../kit';
import { useStore } from '../state';
import { useSelectionPlacement } from './selection-placement';

/** An operation row's Move selection here: shown while artwork is selected,
 * it moves that artwork onto this operation in one undoable step. */
export function AssignSelectionButton({ layer }: { readonly layer: Layer }): JSX.Element | null {
  const placement = useSelectionPlacement(layer.id);
  const assignSelectionToLayer = useStore((state) => state.assignSelectionToLayer);
  if (placement === 'none' || isRegistrationLayer(layer)) return null;
  if (placement === 'here') {
    return <p className="lf-operation-card__assign-note">Selected artwork uses this operation</p>;
  }
  return (
    <button
      type="button"
      className="lf-btn lf-btn--ghost lf-operation-card__assign"
      aria-label={`Move selected artwork to ${layer.name}`}
      title={moveTitle(layer)}
      onClick={() => assignSelectionToLayer(layer.id)}
    >
      <Icon name="arrow-right" size={14} />
      Move selection here
    </button>
  );
}

function moveTitle(layer: Layer): string {
  const base = 'Move the selected artwork onto this operation. It leaves its current operations.';
  return layer.visible
    ? base
    : `${base} This operation is hidden, so the moved artwork is hidden too.`;
}
