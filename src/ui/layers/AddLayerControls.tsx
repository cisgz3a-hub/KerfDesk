import { useStore } from '../state';

const DEFAULT_NEW_LAYER_COLOR = '#000000';
const NEW_LAYER_COLOR_FIELD = 'newLayerColor';

export function AddLayerControls(): JSX.Element {
  const createManualLayer = useStore((state) => state.createManualLayer);
  return (
    <form
      aria-label="Add layer controls"
      style={controlsStyle}
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem(NEW_LAYER_COLOR_FIELD);
        if (field instanceof HTMLInputElement) createManualLayer(field.value);
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
