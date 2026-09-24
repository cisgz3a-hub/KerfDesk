import { isRegistrationLayer, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useSelectionPlacement } from './selection-placement';

/** An operation row's colour swatch works like a LightBurn palette colour:
 * with artwork selected it moves that artwork onto this operation, and with
 * nothing to move it makes this the drawing operation.
 * https://docs.lightburnsoftware.com/2.1/Reference/UI/ColorPalette/ */
export function OperationSwatchButton({ layer }: { readonly layer: Layer }): JSX.Element {
  const placement = useSelectionPlacement(layer.id);
  const assignSelectionToLayer = useStore((state) => state.assignSelectionToLayer);
  const setActiveLayerColor = useUiStore((state) => state.setActiveLayerColor);
  const moves = placement === 'elsewhere' && !isRegistrationLayer(layer);
  return (
    <button
      type="button"
      className="lf-operation-card__swatch"
      aria-label={
        moves
          ? `${layer.name} colour: move selected artwork here`
          : `${layer.name} colour: draw with this operation`
      }
      title={
        moves
          ? `Move the selected artwork onto ${layer.name}`
          : `Draw new artwork with ${layer.name} (operation colour ${layer.color})`
      }
      style={{ background: layer.color }}
      onClick={() => (moves ? assignSelectionToLayer(layer.id) : setActiveLayerColor(layer.color))}
    />
  );
}
