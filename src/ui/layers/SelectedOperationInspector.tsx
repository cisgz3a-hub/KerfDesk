import { useState } from 'react';
import {
  captureLayerOperationSettings,
  operationArtworkCount,
  operationIdsForObject,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../../core/scene/effective-operation';
import { useStore } from '../state';
import { CncLayerFields } from './CncLayerFields';
import { CncSelectionDepthField } from './CncSelectionDepthField';
import { hasMixedFields, mixedOperationFields } from './selected-operation-mixed';
import { LaserOperationFields } from './SelectedLaserOperationFields';
import {
  OperationContextActions,
  OperationNameInput,
  OperationSelect,
  OperationToggles,
} from './OperationInspectorControls';

export function SelectedOperationInspector(props: {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly selectionActive: boolean;
}): JSX.Element | null {
  const layers = useStore((state) => state.project.scene.layers);
  const machineKind = useStore((state) => state.project.machine?.kind ?? 'laser');
  const assignOperation = useStore((state) => state.useOperationForObjects);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const context = selectionOperationContext(props.objects, layers);
  const objectIds = props.objects.map((object) => object.id);
  if (context.candidates.length === 0) return null;
  const active =
    context.candidates.find((operation) => operation.id === requestedId) ??
    context.common[0] ??
    context.candidates[0];
  if (active === undefined) return null;

  if (context.common.length === 0) {
    return (
      <section aria-label="Multiple artwork operations" className="lf-operation-inspector">
        <h3 className="lf-operation-inspector__heading">Multiple operations</h3>
        <p className="lf-artwork-hint">
          These {props.objects.length} artworks have separate settings. Keep them independent or
          choose one operation to share.
        </p>
        {machineKind === 'cnc' ? (
          <CncSelectionDepthField objects={props.objects} operations={context.candidates} />
        ) : null}
        <OperationSelect
          operations={context.candidates}
          value={active.id}
          onChange={setRequestedId}
        />
        <button
          type="button"
          title="Assign one shared operation and its settings to every selected artwork"
          onClick={() => assignOperation(objectIds, active.id)}
          className="lf-btn"
        >
          Use one operation for selection
        </button>
      </section>
    );
  }

  return (
    <SelectedOperationEditor
      key={active.id}
      active={active}
      candidates={context.candidates}
      objects={props.objects}
      machineKind={machineKind}
      selectionActive={props.selectionActive}
      onSelect={setRequestedId}
    />
  );
}

function SelectedOperationEditor(props: {
  readonly active: Layer;
  readonly candidates: ReadonlyArray<Layer>;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly machineKind: 'laser' | 'cnc';
  readonly selectionActive: boolean;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  const makeUnique = useStore((state) => state.makeOperationUniqueForObjects);
  const addOperation = useStore((state) => state.addOperationForObjects);
  const renameOperation = useStore((state) => state.renameOperation);
  const allObjects = useStore((state) => state.project.scene.objects);
  const layers = useStore((state) => state.project.scene.layers);
  const affected = operationArtworkCount(allObjects, props.active);
  const objectIds = props.objects.map((object) => object.id);
  const activeObjects = props.objects.filter((object) =>
    operationIdsForObject(object, layers).includes(props.active.id),
  );
  const { overrideEditing, effectiveOperation, mixedFields, selectionKey, reconcileKey } =
    selectedOperationSettings(props.active, activeObjects);
  return (
    <section
      aria-label={props.selectionActive ? 'Selected artwork operation' : 'Artwork operation'}
      className="lf-operation-inspector"
    >
      <OperationChoice
        operations={props.candidates}
        activeId={props.active.id}
        onSelect={props.onSelect}
      />
      {affected > 1 && !(overrideEditing && props.machineKind === 'laser') ? (
        <p className="lf-artwork-hint lf-operation-scope">
          Shared by {affected} artworks. Edits apply to all of them.
        </p>
      ) : null}
      {props.machineKind === 'laser' && overrideEditing && !hasMixedFields(mixedFields) ? (
        <p className="lf-artwork-hint lf-operation-scope">
          This artwork has its own settings. The values shown here are used for its output.
        </p>
      ) : null}
      {props.machineKind === 'cnc' ? (
        <CncLayerFields layer={props.active} />
      ) : (
        <LaserOperationFields
          key={selectionKey}
          operation={effectiveOperation}
          baseOperation={props.active}
          editObjectOverride={overrideEditing}
          objectIds={activeObjects.map((object) => object.id)}
          ariaContext={props.selectionActive ? 'selected objects' : 'inspected artwork'}
          mixedFields={mixedFields}
          reconcileKey={reconcileKey}
        />
      )}
      <OperationIdentity operation={props.active} onRename={renameOperation} />
      <OperationToggles operation={props.active} affected={affected} />
      <OperationContextActions
        affected={affected}
        selectedUsingActive={activeObjects.length}
        overrideEditing={overrideEditing && props.machineKind === 'laser'}
        onMakeUnique={() =>
          inspectCreatedOperation(() => makeUnique(objectIds, props.active.id), props.onSelect)
        }
        onAdd={() => inspectCreatedOperation(() => addOperation(objectIds), props.onSelect)}
      />
      <CompatibilityNote
        objects={props.objects}
        operation={effectiveOperation}
        machineKind={props.machineKind}
      />
    </section>
  );
}

function OperationChoice(props: {
  readonly operations: ReadonlyArray<Layer>;
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
}): JSX.Element | null {
  if (props.operations.length <= 1) return null;
  return (
    <OperationSelect
      operations={props.operations}
      value={props.activeId}
      onChange={props.onSelect}
    />
  );
}

function OperationIdentity(props: {
  readonly operation: Layer;
  readonly onRename: (id: string, name: string) => void;
}): JSX.Element {
  return (
    <div className="lf-operation-identity">
      <span className="lf-operation-swatch" style={{ background: props.operation.color }} />
      <label>
        <span className="lf-artwork-eyebrow">Operation name</span>
        <OperationNameInput
          operationId={props.operation.id}
          name={props.operation.name}
          onRename={props.onRename}
        />
      </label>
    </div>
  );
}

function inspectCreatedOperation(create: () => void, onSelect: (id: string) => void): void {
  const existingIds = new Set(useStore.getState().project.scene.layers.map((layer) => layer.id));
  create();
  const added = useStore
    .getState()
    .project.scene.layers.find((layer) => !existingIds.has(layer.id));
  if (added !== undefined) onSelect(added.id);
}

function selectedOperationSettings(operation: Layer, objects: ReadonlyArray<SceneObject>) {
  const settings = objects.map((object) => effectiveOperationForObject(operation, object));
  const effectiveOperation = settings[0] ?? operation;
  return {
    overrideEditing: objects.some(
      (object) => operationOverrideForObject(operation, object) !== undefined,
    ),
    effectiveOperation,
    mixedFields: mixedOperationFields(effectiveOperation, settings),
    selectionKey: JSON.stringify(objects.map((object) => object.id)),
    // Mixed fields share a null display baseline; every selected value must
    // participate in cancelling a draft parsed against an older store state.
    reconcileKey: JSON.stringify(settings.map(captureLayerOperationSettings)),
  };
}

function CompatibilityNote(props: {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly operation: Layer;
  readonly machineKind: 'laser' | 'cnc';
}): JSX.Element | null {
  if (
    props.machineKind === 'cnc' &&
    props.objects.some((object) => object.kind === 'raster-image')
  ) {
    return (
      <p style={advisoryStyle}>Raster artwork is visible, but CNC output needs vector contours.</p>
    );
  }
  if (props.machineKind === 'laser' && props.objects.some((object) => object.kind === 'relief')) {
    return (
      <p style={advisoryStyle}>Relief artwork is a CNC operation and has no laser toolpath.</p>
    );
  }
  if (
    props.machineKind === 'laser' &&
    props.operation.mode !== 'image' &&
    props.objects.some((object) => object.kind === 'raster-image')
  ) {
    return <p style={advisoryStyle}>Raster artwork needs an Image process for laser output.</p>;
  }
  if (
    props.machineKind === 'laser' &&
    props.operation.mode === 'image' &&
    props.objects.some((object) => 'paths' in object)
  ) {
    return (
      <p style={advisoryStyle}>Vector artwork needs a Line or Fill process for laser output.</p>
    );
  }
  return null;
}

function selectionOperationContext(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
) {
  const idsByObject = objects.map((object) => operationIdsForObject(object, layers));
  const candidateIds = [...new Set(idsByObject.flat())];
  const commonIds = candidateIds.filter((id) => idsByObject.every((ids) => ids.includes(id)));
  return {
    candidates: candidateIds.flatMap((id) => layers.find((layer) => layer.id === id) ?? []),
    common: commonIds.flatMap((id) => layers.find((layer) => layer.id === id) ?? []),
  };
}

const advisoryStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
};
