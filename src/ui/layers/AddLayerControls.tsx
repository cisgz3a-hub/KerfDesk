import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

// eslint-disable-next-line no-restricted-syntax -- scene DATA: the new layer's color key (what the laser cuts by), not chrome (ADR-047).
const DEFAULT_NEW_LAYER_COLOR = '#000000';
const NEW_LAYER_COLOR_FIELD = 'newLayerColor';

export function AddLayerControls(): JSX.Element {
  const createManualLayer = useStore((state) => state.createManualLayer);
  const setActiveLayerColor = useUiStore((state) => state.setActiveLayerColor);
  return (
    <form
      aria-label="Add layer controls"
      style={controlsStyle}
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem(NEW_LAYER_COLOR_FIELD);
        if (field instanceof HTMLInputElement) {
          const color = field.value.toLowerCase();
          createManualLayer(color);
          setActiveLayerColor(color);
        }
      }}
    >
      <input
        name={NEW_LAYER_COLOR_FIELD}
        type="color"
        defaultValue={DEFAULT_NEW_LAYER_COLOR}
        aria-label="New layer color"
        style={colorInputStyle}
      />
      <button type="submit" aria-label="Add layer">
        Add
      </button>
    </form>
  );
}

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
};

const colorInputStyle: React.CSSProperties = {
  width: 34,
  height: 28,
  padding: 0,
};
