import {
  sceneObjectUsesLayerColor,
  type CncLayerSettings,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { Row } from './CncLayerPrimitives';

export function CncTabPositionControls(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
}): JSX.Element {
  const { layer, settings } = props;
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const hasAdditionalSelection = useStore((state) => state.additionalSelectedIds.size > 0);
  const selectedObject = useStore((state) =>
    state.project.scene.objects.find((object) => object.id === state.selectedObjectId),
  );
  const seedAnchors = useStore((state) => state.seedSelectedCncTabAnchors);
  const resetAnchors = useStore((state) => state.resetSelectedCncTabAnchors);
  const fitToSelection = useStore((state) => state.fitToSelection);
  const toolMode = useUiStore((state) => state.toolMode);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const manualCount =
    selectedObject?.cncTabAnchors?.filter((anchor) => anchor.layerColor === layer.color).length ??
    0;
  const canEdit = canEditTabPositions(
    selectedObjectId,
    hasAdditionalSelection,
    selectedObject,
    layer.color,
    settings,
  );
  const editing = toolMode.kind === 'cnc-tabs' && toolMode.layerColor === layer.color;
  return (
    <Row label="Tab positions">
      <button
        type="button"
        disabled={!canEdit}
        aria-pressed={editing}
        title={
          canEdit
            ? 'Show the tabs on the selected contour and drag them to better locations.'
            : 'Select one unlocked profile object to edit its tab positions.'
        }
        onClick={() => {
          seedAnchors(layer.color, settings.tabsPerShape);
          setToolMode({ kind: 'cnc-tabs', layerColor: layer.color });
          fitToSelection();
        }}
      >
        Edit positions
      </button>
      {manualCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            resetAnchors(layer.color);
            useUiStore.getState().resetToolMode();
          }}
          title="Discard dragged positions and distribute tabs automatically again."
        >
          Reset automatic
        </button>
      ) : null}
    </Row>
  );
}

function canEditTabPositions(
  selectedObjectId: string | null,
  hasAdditionalSelection: boolean,
  selectedObject: SceneObject | undefined,
  layerColor: string,
  settings: CncLayerSettings,
): boolean {
  return (
    selectedObjectId !== null &&
    !hasAdditionalSelection &&
    selectedObject !== undefined &&
    selectedObject.locked !== true &&
    'paths' in selectedObject &&
    sceneObjectUsesLayerColor(selectedObject, layerColor) &&
    settings.cutType.startsWith('profile')
  );
}
