import { pathUsesOperation, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { NumberField, Row } from './CncLayerPrimitives';
import { CncTabPositionControls } from './CncTabPositionControls';

// Holding tabs stay with the core profile controls so part retention remains
// prominent before the Advanced helper and specialist section.
export function CncTabFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, onCommit } = props;
  const manualProfile = settings.cutType.startsWith('profile');
  return (
    <>
      <Row label="Tabs">
        <input
          type="checkbox"
          checked={settings.tabsEnabled}
          onChange={(e) => {
            onCommit({ tabsEnabled: e.target.checked });
            if (!e.target.checked) disarmMatchingTabEditor(layer);
          }}
          aria-label={`Holding tabs for ${layer.color}`}
          title="Leave small bridges on the deepest passes so cut-out parts stay attached."
        />
      </Row>
      {settings.tabsEnabled ? (
        <>
          <NumberField
            layer={layer}
            label="Tab height"
            unit="mm"
            value={settings.tabHeightMm}
            min={0.2}
            max={20}
            step={0.2}
            title="Material left under each tab, measured up from the cut floor."
            onCommit={(tabHeightMm) => onCommit({ tabHeightMm })}
          />
          <NumberField
            layer={layer}
            label="Tab width"
            unit="mm"
            value={settings.tabWidthMm}
            min={0.5}
            max={30}
            step={0.5}
            title="Length of each tab along the cut path."
            onCommit={(tabWidthMm) => onCommit({ tabWidthMm })}
          />
          <NumberField
            layer={layer}
            label="Tabs per shape"
            unit=""
            value={settings.tabsPerShape}
            min={1}
            max={16}
            step={1}
            title={
              manualProfile
                ? 'Changing the count spreads saved tabs evenly on unlocked paths used only by this operation. Shared paths and locked artwork keep their saved positions.'
                : 'Number of tabs spread around each closed shape.'
            }
            onCommit={(tabsPerShape) => onCommit({ tabsPerShape: Math.floor(tabsPerShape) })}
          />
          {manualProfile ? (
            <p style={{ fontSize: 11, margin: 0 }}>
              Changing the count replaces dragged positions on unlocked paths used only by this
              operation. Paths shared with another operation and locked artwork keep their saved
              positions.
            </p>
          ) : null}
          <CncTabPositionControls layer={layer} settings={settings} />
        </>
      ) : null}
    </>
  );
}

function disarmMatchingTabEditor(layer: Layer): void {
  const ui = useUiStore.getState();
  const mode = ui.toolMode;
  if (mode.kind !== 'cnc-tabs') return;
  const state = useStore.getState();
  const object = state.project.scene.objects.find((entry) => entry.id === state.selectedObjectId);
  const matches =
    mode.operationId !== undefined
      ? mode.operationId === layer.id
      : object !== undefined &&
        'paths' in object &&
        object.paths.some(
          (path) => path.color === mode.layerColor && pathUsesOperation(object, path, layer),
        );
  if (matches) ui.resetToolMode();
}
