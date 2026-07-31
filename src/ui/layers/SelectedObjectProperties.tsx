import { useEffect, useMemo, useState } from 'react';
import {
  artworkOperationName,
  isRegistrationBox,
  primaryOperationForObject,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { SelectedImageAdjustments } from './SelectedImageAdjustments';
import { SelectedOperationInspector } from './SelectedOperationInspector';
import {
  isParametricShapeObject,
  SelectedShapeGeometryFields,
} from './SelectedShapeGeometryFields';
import { useDebouncedCommit } from './use-debounced-commit';

const DEFAULT_POWER_SCALE_PERCENT = 100;
const MIN_POWER_SCALE_PERCENT = 0;
const MAX_POWER_SCALE_PERCENT = 100;

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
      key={JSON.stringify([
        context.primaryObject.id,
        ...context.objects.map((object) => object.id),
      ])}
      artwork={artwork}
      layers={layers}
      context={context}
      isCncMachine={isCncMachine}
      onChooseArtwork={setInspectedObjectId}
      setShapeSpec={setShapeSpec}
    />
  );
}

function ArtworkPropertiesInspector(props: {
  readonly artwork: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
  readonly context: ArtworkInspectorContext;
  readonly isCncMachine: boolean;
  readonly onChooseArtwork: (id: string) => void;
  readonly setShapeSpec: ReturnType<typeof useStore.getState>['setShapeSpec'];
}): JSX.Element {
  const { context } = props;
  const parametricShape = singleParametricShape(context.objects);
  const rasterImage = rasterImageForObject(context.primaryObject);
  return (
    <section
      aria-label={context.selectionActive ? 'Selected object properties' : 'Artwork properties'}
      style={sectionStyle}
    >
      <h3 style={headingStyle}>{artworkInspectorHeading(context)}</h3>
      {context.selectionActive ? null : (
        <ArtworkTargetChooser
          artwork={props.artwork}
          layers={props.layers}
          value={context.objects[0]?.id ?? ''}
          onChange={props.onChooseArtwork}
        />
      )}
      {parametricShape === null ? null : (
        <SelectedShapeGeometryFields
          object={parametricShape}
          setSpec={(spec) => props.setShapeSpec(parametricShape.id, spec)}
        />
      )}
      {props.isCncMachine ? null : (
        <PowerScaleInput objects={context.objects} selectionActive={context.selectionActive} />
      )}
      <SelectedOperationInspector
        objects={context.objects}
        selectionActive={context.selectionActive}
      />
      {props.isCncMachine ? null : <SelectedImageAdjustments image={rasterImage} />}
    </section>
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

function artworkInspectorHeading(context: ArtworkInspectorContext): string {
  if (!context.selectionActive) return 'Artwork settings';
  return context.objects.length === 1
    ? 'Selected artwork'
    : `${context.objects.length} artworks selected`;
}

function ArtworkTargetChooser(props: {
  readonly artwork: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
  readonly value: string;
  readonly onChange: (id: string) => void;
}): JSX.Element {
  const options = artworkOptions(props.artwork, props.layers);
  return (
    <div style={targetChooserStyle}>
      <p style={targetHintStyle}>Nothing selected on canvas. Settings remain editable here.</p>
      {options.length > 1 ? (
        <label style={rowStyle}>
          <span style={labelStyle}>Artwork</span>
          <select
            value={props.value}
            aria-label="Artwork to inspect"
            title="Choose which artwork settings to edit without selecting it on the canvas"
            onChange={(event) => props.onChange(event.target.value)}
            style={inputStyle}
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

function PowerScaleInput(props: {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly selectionActive: boolean;
}): JSX.Element {
  const setObjectsPowerScale = useStore((s) => s.setObjectsPowerScale);
  const objectIds = props.objects.map((object) => object.id);
  const value = commonPowerScale(props.objects);
  const debounced = useDebouncedCommit<number>({
    value,
    commit: (powerScale) => setObjectsPowerScale(objectIds, powerScale),
    parse: (input) => clampPowerScale(Number(input)),
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Power Scale</span>
      <span style={controlStyle}>
        <input
          type="number"
          min={MIN_POWER_SCALE_PERCENT}
          max={MAX_POWER_SCALE_PERCENT}
          step={1}
          value={debounced.displayValue}
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          aria-label={`Power scale for ${props.selectionActive ? 'selected objects' : 'inspected artwork'}`}
          title="Scale laser power for this artwork context without changing its operation setting."
          style={inputStyle}
        />
        <span style={unitStyle}>%</span>
      </span>
    </label>
  );
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

function artworkOptions(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const bases = objects.map(
    (object) => primaryOperationForObject(object, layers)?.name ?? artworkOperationName(object),
  );
  const totals = new Map<string, number>();
  bases.forEach((base) => totals.set(base, (totals.get(base) ?? 0) + 1));
  const seen = new Map<string, number>();
  return objects.map((object, index) => {
    const base = bases[index] ?? artworkOperationName(object);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { id: object.id, label: totals.get(base) === 1 ? base : `${base} (${occurrence})` };
  });
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

function commonPowerScale(objects: ReadonlyArray<SceneObject>): number {
  const first = objects[0]?.powerScale ?? DEFAULT_POWER_SCALE_PERCENT;
  return objects.every((object) => (object.powerScale ?? DEFAULT_POWER_SCALE_PERCENT) === first)
    ? first
    : DEFAULT_POWER_SCALE_PERCENT;
}

function clampPowerScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POWER_SCALE_PERCENT;
  return Math.max(MIN_POWER_SCALE_PERCENT, Math.min(MAX_POWER_SCALE_PERCENT, value));
}

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  marginTop: 12,
  paddingTop: 10,
};
const headingStyle: React.CSSProperties = { fontSize: 13, margin: '0 0 8px 0' };
const targetChooserStyle: React.CSSProperties = { marginBottom: 8 };
const targetHintStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
