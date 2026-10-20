// PlaceBoardSteps — steps 2 and 3 of the Place Board page (ADR-636). Step 2
// brings artwork in and places it on the board; step 3 sets its laser power,
// speed and passes, then Frame and Start, which are the workspace's own job
// actions mounted here while the page is open (as jig mode does, ADR-641).

import {
  isRegistrationBox,
  REGISTRATION_LAYER_ID,
  sceneObjectUsesOperation,
  type Layer,
  type Scene,
} from '../../../core/scene';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { handleUnifiedArtworkImport } from '../../app/import-dispatch';
import { usePlatformOptional } from '../../app/platform-context';
import { Button } from '../../kit';
import { DraftNumberInput } from '../../kit/DraftNumberInput';
import { useStore } from '../../state';
import { useToastStore } from '../../state/toast-store';
import { WorkspaceJobActions } from '../WorkspaceJobActions';
import { BoardArtworkPlacement } from './BoardPlacementControls';
import { sceneHasCapturedBoard } from './captured-board-outline';

export function PlaceBoardArtworkStep(props: {
  readonly geometry: CapturedBoardGeometry | null;
  readonly onGoToBoard: () => void;
}): JSX.Element {
  const platform = usePlatformOptional();
  if (props.geometry === null) return <NeedsBoard onGoToBoard={props.onGoToBoard} />;
  const importArtwork = (): void => {
    if (platform === null) return;
    const app = useStore.getState();
    void handleUnifiedArtworkImport(platform, {
      getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
      importSvgObject: app.importSvgObject,
      importSvgFragment: app.importSvgFragment,
      importRasterImage: app.importRasterImage,
      pushToast: useToastStore.getState().pushToast,
    });
  };
  return (
    <>
      <div className="lf-place-board__card">
        <div className="lf-place-board__card-title">
          <span>Add artwork</span>
        </div>
        <p className="lf-place-board__muted">
          Import a design, or click artwork already in the project on the canvas. Drag it on the
          canvas, or use the grid below.
        </p>
        {platform !== null && (
          <Button
            title="Import SVG, DXF, PDF/AI, HPGL/PLT or image artwork into the project"
            onClick={importArtwork}
          >
            Import artwork…
          </Button>
        )}
      </div>
      <BoardArtworkPlacement shape={props.geometry.kind} />
    </>
  );
}

// Frame and Start follow the board in the project, not this capture session,
// so a saved board reopened later can still be burned (and the machine panel
// gives them up exactly when this step can show them).
export function PlaceBoardBurnStep(props: {
  readonly geometry: CapturedBoardGeometry | null;
  readonly onGoToBoard: () => void;
}): JSX.Element {
  const hasBoard = useStore((state) => sceneHasCapturedBoard(state.project.scene));
  if (!hasBoard) return <NeedsBoard onGoToBoard={props.onGoToBoard} />;
  const origin =
    props.geometry?.kind === 'circle'
      ? 'the centre of the board'
      : 'the front-left corner of the board';
  return (
    <>
      <BoardArtworkLaserSettings />
      <section className="lf-jig-burn" aria-label="Frame and Start">
        <strong>Burn on the board</strong>
        <p className="lf-jig-muted">
          The work origin is {origin}, set when the board was captured. Frame to trace the artwork
          on the board, then Start.
        </p>
        <WorkspaceJobActions />
      </section>
    </>
  );
}

function NeedsBoard(props: { readonly onGoToBoard: () => void }): JSX.Element {
  return (
    <>
      <p className="lf-jig-muted">Capture the board in step 1 first.</p>
      <Button title="Go to step 1 to capture the board" onClick={props.onGoToBoard}>
        Go to step 1
      </Button>
    </>
  );
}

// Power, speed and passes for each operation the artwork on the board uses.
function BoardArtworkLaserSettings(): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  const maxFeed = useStore((state) => state.project.device.maxFeed);
  const setLayerParam = useStore((state) => state.setLayerParam);
  const layers = boardArtworkLayers(scene);
  if (layers.length === 0) {
    return <p className="lf-jig-muted">Add artwork in step 2 to set its laser settings.</p>;
  }
  return (
    <section className="lf-jig-fields" aria-label="Artwork laser settings">
      <strong>Laser settings</strong>
      {layers.map((layer) => (
        <fieldset key={layer.id} className="lf-place-board__layer">
          <legend>
            <span className="lf-place-board__swatch" style={{ background: layer.color }} />
            {layer.name}
          </legend>
          <LayerNumber
            label="Power (%)"
            title={`Laser power for ${layer.name}, 0–100 %`}
            value={layer.power}
            normalize={(value) => Math.min(100, Math.max(0, value))}
            onChange={(power) => setLayerParam(layer.id, { power })}
          />
          <LayerNumber
            label="Speed (mm/min)"
            title={`Speed for ${layer.name}, up to the machine's ${maxFeed} mm/min`}
            value={layer.speed}
            normalize={(value) => Math.min(maxFeed, Math.max(1, value))}
            onChange={(speed) => setLayerParam(layer.id, { speed })}
          />
          <LayerNumber
            label="Passes"
            title={`How many times ${layer.name} is burned`}
            value={layer.passes}
            normalize={(value) => Math.max(1, Math.round(value))}
            onChange={(passes) => setLayerParam(layer.id, { passes })}
          />
        </fieldset>
      ))}
    </section>
  );
}

function LayerNumber(props: {
  readonly label: string;
  readonly title: string;
  readonly value: number;
  readonly normalize: (value: number) => number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="lf-place-board__field">
      {props.label}
      <DraftNumberInput
        aria-label={props.label}
        title={props.title}
        value={props.value}
        normalize={props.normalize}
        onValueChange={props.onChange}
        style={{ width: 96 }}
      />
    </label>
  );
}

/** The operations that burn the artwork: everything but the board outline. */
export function boardArtworkLayers(scene: Scene): ReadonlyArray<Layer> {
  const artwork = scene.objects.filter((object) => !isRegistrationBox(object));
  return scene.layers.filter(
    (layer) =>
      layer.id !== REGISTRATION_LAYER_ID &&
      layer.output &&
      artwork.some((object) => sceneObjectUsesOperation(object, layer)),
  );
}
