import { useEffect, useId, useMemo, useState } from 'react';
import {
  isRegistrationBox,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { SelectedBarcodeSummary } from '../barcode/SelectedBarcodeSummary';
import { useStore } from '../state';
import { ArtworkEditorTabs, type ArtworkEditorView } from './ArtworkEditorTabs';
import { ConstrainedSketchControls } from './ConstrainedSketchControls';
import { ParametricPartControls } from './ParametricPartControls';
import { DogboneRow } from './DogboneRow';
import { OffsetPathsRow } from './OffsetPathsRow';
import { SelectedImageAdjustments } from './SelectedImageAdjustments';
import { SelectedOperationInspector } from './SelectedOperationInspector';
import { SelectedReliefProperties } from './SelectedReliefProperties';
import { SelectedSourceReimportControl } from './SelectedSourceReimportControl';
import { SelectedImageReplaceControl } from './SelectedImageReplaceControl';
import {
  isParametricShapeObject,
  SelectedShapeGeometryFields,
} from './SelectedShapeGeometryFields';
import { AdvancedArtworkSettings } from './AdvancedArtworkSettings';
import { useSimpleView } from '../state/simple-view';
import { showsPowerMultiplier } from './simple-view-hidden-values';
import { artworkDisplayName, artworkDisplayNames } from './artwork-display-names';

export function SelectedObjectProperties(): JSX.Element | null {
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const objects = useStore((s) => s.project.scene.objects);
  const layers = useStore((s) => s.project.scene.layers);
  const isCncMachine = useStore((s) => s.project.machine?.kind === 'cnc');
  const setShapeSpec = useStore((s) => s.setShapeSpec);
  const [inspectedObjectId, setInspectedObjectId] = useState<string | null>(null);
  const artwork = useMemo(
    () => objects.filter((object) => !isRegistrationBox(object) && object.locked !== true),
    [objects],
  );
  const names = useMemo(() => artworkDisplayNames(objects), [objects]);
  const selectedObjects = useMemo(
    () => selectedSceneObjects(artwork, selectedObjectId, additionalSelectedIds),
    [artwork, selectedObjectId, additionalSelectedIds],
  );
  const selectedInspectedId = primarySelectedObjectId(selectedObjects, selectedObjectId);
  useEffect(() => {
    if (selectedInspectedId !== null) setInspectedObjectId(selectedInspectedId);
  }, [selectedInspectedId]);
  const context = artworkInspectorContext(
    artwork,
    selectedObjects,
    selectedInspectedId,
    inspectedObjectId,
  );
  if (context === null) return null;
  return (
    <ArtworkPropertiesInspector
      artwork={artwork}
      names={names}
      layers={layers}
      context={context}
      isCncMachine={isCncMachine}
      onChooseArtwork={setInspectedObjectId}
      setShapeSpec={setShapeSpec}
    />
  );
}

type ArtworkPropertiesInspectorProps = {
  readonly artwork: ReadonlyArray<SceneObject>;
  readonly names: ReadonlyMap<string, string>;
  readonly layers: ReadonlyArray<Layer>;
  readonly context: ArtworkInspectorContext;
  readonly isCncMachine: boolean;
  readonly onChooseArtwork: (id: string) => void;
  readonly setShapeSpec: ReturnType<typeof useStore.getState>['setShapeSpec'];
};

function ArtworkPropertiesInspector(props: ArtworkPropertiesInspectorProps): JSX.Element {
  const { context } = props;
  const [editorView, setEditorView] = useState<ArtworkEditorView>('operation');
  const editorId = useId();
  const contextKey = JSON.stringify([
    context.primaryObject.id,
    ...context.objects.map((object) => object.id),
  ]);
  return (
    <section
      aria-label={context.selectionActive ? 'Selected object properties' : 'Artwork properties'}
      className="lf-artwork-inspector"
    >
      <header className="lf-artwork-context">
        <ArtworkContextTitle context={context} names={props.names} />
        <ArtworkEditorTabs id={editorId} active={editorView} onSelect={setEditorView} />
      </header>
      {context.selectionActive ? null : (
        <ArtworkTargetChooser
          artwork={props.artwork}
          names={props.names}
          value={context.objects[0]?.id ?? ''}
          onChange={props.onChooseArtwork}
        />
      )}
      <div
        id={`${editorId}-artwork-panel`}
        role="tabpanel"
        aria-labelledby={`${editorId}-artwork-tab`}
        hidden={editorView !== 'artwork'}
        className="lf-artwork-editor-pane lf-artwork-adjustments"
      >
        <ArtworkAdjustmentFields key={contextKey} {...props} />
        <div className="lf-artwork-disclosure__body">
          <ConstrainedSketchControls mode="edit" />
          <ParametricPartControls mode="edit" />
          <OffsetPathsRow />
          <DogboneRow />
          <SelectedReliefProperties />
          {!context.selectionActive ? (
            <p className="lf-artwork-hint">Select artwork on the canvas to use path tools.</p>
          ) : null}
        </div>
      </div>
      <div
        id={`${editorId}-operation-panel`}
        role="tabpanel"
        aria-labelledby={`${editorId}-operation-tab`}
        hidden={editorView !== 'operation'}
        className="lf-artwork-editor-pane"
      >
        <SelectedOperationInspector
          key={contextKey}
          objects={context.objects}
          selectionActive={context.selectionActive}
        />
      </div>
    </section>
  );
}

function ArtworkAdjustmentFields(props: ArtworkPropertiesInspectorProps): JSX.Element {
  const { context } = props;
  const parametricShape = singleParametricShape(context.objects);
  const rasterImage = rasterImageForObject(context.primaryObject);
  const simple = useSimpleView();
  return (
    <div className="lf-artwork-disclosure__body">
      <h3 className="lf-operation-inspector__heading">Artwork adjustments</h3>
      <SelectedBarcodeSummary objects={context.objects} />
      {parametricShape === null ? null : (
        <SelectedShapeGeometryFields
          object={parametricShape}
          setSpec={(spec) => props.setShapeSpec(parametricShape.id, spec)}
        />
      )}
      <SelectedSourceReimportControl
        object={
          context.selectionActive && context.objects.length === 1 ? context.primaryObject : null
        }
      />
      <SelectedImageReplaceControl
        object={
          context.selectionActive && context.objects.length === 1 ? context.primaryObject : null
        }
      />
      {props.isCncMachine ? null : <SelectedImageAdjustments image={rasterImage} />}
      {props.isCncMachine || !showsPowerMultiplier(simple, context.objects) ? null : (
        <AdvancedArtworkSettings
          objects={context.objects}
          layers={props.layers}
          selectionActive={context.selectionActive}
        />
      )}
    </div>
  );
}

type ArtworkInspectorContext = {
  readonly selectionActive: boolean;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly primaryObject: SceneObject;
};

function artworkInspectorContext(
  artwork: ReadonlyArray<SceneObject>,
  selectedObjects: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
  inspectedObjectId: string | null,
): ArtworkInspectorContext | null {
  if (artwork.length === 0) return null;
  const selected = artwork.find((object) => object.id === selectedObjectId) ?? selectedObjects[0];
  if (selected !== undefined) {
    return { selectionActive: true, objects: selectedObjects, primaryObject: selected };
  }
  const inspected = artwork.find((object) => object.id === inspectedObjectId) ?? artwork[0];
  return inspected === undefined
    ? null
    : { selectionActive: false, objects: [inspected], primaryObject: inspected };
}

// One line: a short word for where the artwork came from, then its name, so
// the settings start higher on a short window (ADR-631).
function ArtworkContextTitle(props: {
  readonly context: ArtworkInspectorContext;
  readonly names: ReadonlyMap<string, string>;
}): JSX.Element {
  const { context } = props;
  if (context.objects.length > 1) {
    const count = `${context.objects.length} artworks selected`;
    return (
      <p className="lf-artwork-context__title" title={`${count}. Edits apply to all of them.`}>
        <strong>{count}</strong>
      </p>
    );
  }
  const name = artworkDisplayName(props.names, context.primaryObject);
  return (
    <p className="lf-artwork-context__title" title={name}>
      <span className="lf-artwork-eyebrow">{context.selectionActive ? 'Selected' : 'Editing'}</span>
      <strong>{name}</strong>
    </p>
  );
}

function ArtworkTargetChooser(props: {
  readonly artwork: ReadonlyArray<SceneObject>;
  readonly names: ReadonlyMap<string, string>;
  readonly value: string;
  readonly onChange: (id: string) => void;
}): JSX.Element {
  // The artwork's own name, the same name the header shows, so the picker
  // never reads as a list of operations.
  const options = props.artwork.map((object) => ({
    id: object.id,
    label: artworkDisplayName(props.names, object),
  }));
  return (
    <div className="lf-artwork-target">
      <p className="lf-artwork-hint">Nothing selected on canvas. You can keep editing here.</p>
      {options.length > 1 ? (
        <label style={rowStyle}>
          <span style={labelStyle}>Artwork</span>
          <select
            value={props.value}
            aria-label="Artwork to inspect"
            title="Choose which artwork settings to edit without selecting it on the canvas"
            onChange={(event) => props.onChange(event.target.value)}
            style={chooserSelectStyle}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function singleParametricShape(objects: ReadonlyArray<SceneObject>) {
  const object = objects.length === 1 ? objects[0] : undefined;
  return object?.kind === 'shape' && isParametricShapeObject(object) ? object : null;
}

function rasterImageForObject(object: SceneObject): RasterImage | null {
  return object.kind === 'raster-image' ? object : null;
}

function primarySelectedObjectId(
  objects: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
): string | null {
  return selectedObjectId !== null && objects.some((object) => object.id === selectedObjectId)
    ? selectedObjectId
    : (objects[0]?.id ?? null);
}

function selectedSceneObjects(
  objects: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): ReadonlyArray<SceneObject> {
  const ids = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  return objects.filter((object) => ids.has(object.id));
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '100px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-muted)' };
const chooserSelectStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
};
