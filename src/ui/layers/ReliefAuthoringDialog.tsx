import { ReliefRailCreationControls, ReliefRailSourceControls } from './ReliefRailControls';
import { useMemo, useState } from 'react';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import { IDENTITY_TRANSFORM } from '../../core/scene/scene-object';
import type {
  ReliefComponent,
  ReliefSculptStroke,
  ReliefVectorMask,
} from '../../core/scene/relief/relief-authoring';
import {
  appendReliefStroke,
  createReliefAuthoringDocument,
  reviseReliefDocument,
} from '../../core/relief/relief-authoring-document';
import {
  importReliefComponentAsset,
  type ReliefComponentAsset,
} from '../../io/project/relief-component-asset';
import { Dialog, DialogActions, Button } from '../kit';
import './relief-authoring.css';
import { useStore } from '../state';
import { useReliefAuthoringComposition } from './use-relief-authoring-composition';
import {
  NumberControl,
  ReliefComponentControls,
  vectorMaskForRelief,
} from './ReliefComponentControls';
import { ReliefSculptCanvas } from './ReliefSculptCanvas';
import { ReliefBrushControls } from './ReliefBrushControls';
import { ReliefCompositionControls } from './ReliefCompositionControls';
import { ReliefLocalAssetControls } from './ReliefLocalAssetControls';

// Declarative form chrome and its modal-owned handlers stay together; pure composition and stroke algorithms are independently tested.
// eslint-disable-next-line max-lines-per-function, complexity
export function ReliefAuthoringDialog(props: {
  readonly relief: HeightfieldReliefObject;
  readonly onClose: () => void;
}): JSX.Element {
  const { relief } = props;
  const document = useMemo(
    () => relief.reliefAuthoring ?? createReliefAuthoringDocument(relief.reliefSource),
    [relief.reliefAuthoring, relief.reliefSource],
  );
  const objects = useStore((s) => s.project.scene.objects);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const vectors = objects.filter((o) => 'paths' in o && o.id !== relief.id);
  const closedVectors = vectors.filter(
    (object) =>
      'paths' in object &&
      object.paths.some((path) => path.polylines.length > 0) &&
      object.paths.every((path) =>
        path.polylines.every((line) => line.closed && line.points.length >= 3),
      ),
  );
  const [selectedId, setSelectedId] = useState(document.components[0]?.id ?? '');
  const selected = document.components.find((c) => c.id === selectedId) ?? document.components[0];
  const [vectorId, setVectorId] = useState(closedVectors[0]?.id ?? '');
  const [profile, setProfile] = useState<'plane' | 'dome' | 'slope'>('plane');
  const [mode, setMode] = useState<ReliefSculptStroke['mode']>('add');
  const [diameter, setDiameter] = useState(5);
  const [strength, setStrength] = useState(0.25);
  const [flattenHeight, setFlattenHeight] = useState(document.maxDepthMm / 2);
  const [brushRegionId, setBrushRegionId] = useState('');
  const [asset, setAsset] = useState<ReliefComponentAsset | null>(null);
  const {
    busy,
    progress,
    message,
    setMessage,
    preview,
    setPreview,
    prepare,
    cancel,
    commitPreview,
  } = useReliefAuthoringComposition(relief);
  function updateComponent(patch: Partial<ReliefComponent>): void {
    if (selected === undefined) return;
    void prepare(
      reviseReliefDocument(document, {
        components: document.components.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)),
      }),
    );
  }
  function setComponentMask(mask: ReliefVectorMask | null): void {
    if (selected === undefined) return;
    const components = document.components.map((c) => {
      if (c.id !== selected.id) return c;
      const { mask: priorMask, ...withoutMask } = c;
      void priorMask;
      return mask === null ? withoutMask : { ...withoutMask, mask };
    });
    void prepare(reviseReliefDocument(document, { components }));
  }
  function addShape(): void {
    const vector = closedVectors.find((o) => o.id === vectorId) ?? closedVectors[0];
    if (vector === undefined) {
      setMessage('Choose closed vector artwork for the shape.');
      return;
    }
    const id = crypto.randomUUID();
    const component: ReliefComponent = {
      id,
      name: `${profile} from ${vector.name ?? vector.id}`,
      levelId: document.levels[0]?.id ?? 'level-1',
      visible: true,
      combineMode: 'max',
      transform: IDENTITY_TRANSFORM,
      baseHeightMm: 0,
      heightScale: 1,
      source: {
        kind: 'vector-shape-v1',
        boundary: vectorMaskForRelief(vector, relief.transform),
        profile,
        heightMm: document.maxDepthMm / 2,
        angleDeg: 0,
      },
    };
    setSelectedId(id);
    void prepare(
      reviseReliefDocument(document, { components: [...document.components, component] }),
    );
  }
  function applyStroke(points: ReliefSculptStroke['points']): void {
    if (selected === undefined) {
      setMessage('Select or create a component before sculpting.');
      return;
    }
    const regionObject = vectors.find((o) => o.id === brushRegionId);
    const stroke: ReliefSculptStroke = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      componentId: selected.id,
      mode,
      points,
      diameterMm: diameter,
      strength,
      flattenHeightMm: flattenHeight,
      metricScaleX: Math.abs(relief.transform.scaleX),
      metricScaleY: Math.abs(relief.transform.scaleY),
      ...(regionObject === undefined
        ? {}
        : { region: vectorMaskForRelief(regionObject, relief.transform) }),
    };
    void prepare(appendReliefStroke(document, stroke));
  }
  function setGlobalClip(id: string): void {
    const vector = vectors.find((o) => o.id === id);
    const { clip: priorClip, ...withoutClip } = document;
    void priorClip;
    void prepare(
      reviseReliefDocument(
        withoutClip,
        vector === undefined ? {} : { clip: vectorMaskForRelief(vector, relief.transform) },
      ),
    );
  }
  function applyPreview(): void {
    if (preview === null || !commitPreview()) return;
    setAsset(null);
    setSelectedId(preview.document.components.at(-1)?.id ?? '');
  }
  const disabled = busy || preview !== null;
  return (
    <Dialog
      ariaLabel="Relief authoring"
      title="Edit relief components"
      size="xl"
      panelClassName="lf-relief-authoring-dialog"
      onClose={props.onClose}
    >
      <p className="lf-relief-note">
        Sculpt the selected component or add shapes from closed vectors. Each completed edit is
        saved to the project and can be undone.
      </p>
      <div className="lf-relief-authoring-layout">
        <div className="lf-relief-sculpt-pane">
          <p className="lf-relief-note">
            {document.physicalWidthMm} × {document.physicalHeightMm} mm · {document.maxDepthMm} mm
            deep
          </p>
          <ReliefSculptCanvas
            field={preview?.field ?? relief.reliefSource}
            disabled={disabled || selected === undefined}
            brushMode={mode}
            onStroke={applyStroke}
          />
          <ReliefBrushControls
            disabled={disabled || selected === undefined}
            mode={mode}
            setMode={setMode}
            diameter={diameter}
            setDiameter={setDiameter}
            strength={strength}
            setStrength={setStrength}
            flattenHeight={flattenHeight}
            setFlattenHeight={setFlattenHeight}
            vectors={closedVectors}
            regionId={brushRegionId}
            setRegionId={setBrushRegionId}
          />
          <button
            title="Undo the last retained relief edit, including a complete sculpt stroke"
            type="button"
            disabled={busy || preview !== null || !canUndo}
            onClick={undo}
          >
            Undo last edit
          </button>{' '}
          <button
            title="Redo the last undone relief edit"
            type="button"
            disabled={busy || preview !== null || !canRedo}
            onClick={redo}
          >
            Redo
          </button>
          {busy ? (
            <>
              <p role="status">Composing relief {Math.round(progress * 100)}%</p>
              <button
                title="Cancel the current relief composition preparation"
                type="button"
                onClick={cancel}
              >
                Cancel preparation
              </button>
            </>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
          <details className="lf-relief-advanced">
            <summary title="Show reusable component assets for this relief">
              Reusable components
            </summary>
            <ReliefLocalAssetControls
              document={document}
              component={selected}
              disabled={disabled}
              onPreview={(value) => {
                setAsset(value);
                setPreview(null);
              }}
              onError={setMessage}
            />
            {asset !== null ? (
              <fieldset disabled={busy}>
                <legend>Import component preview</legend>
                <p>
                  {asset.component.name}: original authoring area {asset.physicalWidthMm} ×{' '}
                  {asset.physicalHeightMm} mm. Units stay in millimetres.
                </p>
                <NumberControl
                  label="Imported component base (mm)"
                  value={asset.component.baseHeightMm}
                  commit={(baseHeightMm) => {
                    setAsset({ ...asset, component: { ...asset.component, baseHeightMm } });
                    setPreview(null);
                  }}
                />
                <NumberControl
                  label="Imported component XY scale"
                  value={asset.component.transform.scaleX}
                  commit={(scale) => {
                    setAsset({
                      ...asset,
                      component: {
                        ...asset.component,
                        transform: { ...asset.component.transform, scaleX: scale, scaleY: scale },
                      },
                    });
                    setPreview(null);
                  }}
                />
                <button
                  title="Compose the opened component into a preview before adding it"
                  type="button"
                  onClick={() => {
                    void prepare(
                      importReliefComponentAsset(document, asset, crypto.randomUUID()),
                      true,
                    );
                  }}
                >
                  Preview component
                </button>
                <button
                  title="Add the current previewed component to this relief"
                  type="button"
                  disabled={preview === null}
                  onClick={applyPreview}
                >
                  Add previewed component
                </button>
                <button
                  title="Discard the opened component and its preview"
                  type="button"
                  onClick={() => {
                    setAsset(null);
                    setPreview(null);
                  }}
                >
                  Discard preview
                </button>
              </fieldset>
            ) : null}
          </details>
        </div>
        <div className="lf-relief-components-pane">
          <ReliefCompositionControls
            document={document}
            selected={selected}
            field={relief.reliefSource}
            disabled={disabled}
            vectors={closedVectors}
            vectorId={
              closedVectors.some((item) => item.id === vectorId)
                ? vectorId
                : (closedVectors[0]?.id ?? '')
            }
            profile={profile}
            setVectorId={setVectorId}
            setProfile={setProfile}
            setSelectedId={setSelectedId}
            setGlobalClip={setGlobalClip}
            addShape={addShape}
            prepare={prepare}
          />
          <details className="lf-relief-advanced">
            <summary title="Create relief surfaces from rails and cross-section profiles">
              Rail and profile surfaces
            </summary>
            <ReliefRailCreationControls
              document={document}
              vectors={vectors}
              reliefTransform={relief.transform}
              disabled={disabled}
              prepare={prepare}
              setSelectedId={setSelectedId}
            />
          </details>
          {selected !== undefined ? (
            <ReliefComponentControls
              key={`component-controls:${selected.id}`}
              component={selected}
              document={document}
              vectors={closedVectors}
              reliefTransform={relief.transform}
              disabled={disabled}
              onPatch={updateComponent}
              onClip={setComponentMask}
            />
          ) : null}
          {selected === undefined ? null : (
            <ReliefRailSourceControls
              key={`rail-source-controls:${selected.id}`}
              component={selected}
              disabled={disabled}
              onPatch={updateComponent}
            />
          )}
        </div>
      </div>
      <details className="lf-relief-advanced">
        <summary title="Show relief sampling resolution and supported surface geometry">
          Relief resolution and surface model
        </summary>
        <p className="lf-relief-note">
          Authoring {document.width} × {document.height} cells;{' '}
          {(document.physicalWidthMm / document.width).toPrecision(4)} ×{' '}
          {(document.physicalHeightMm / document.height).toPrecision(4)} mm/cell. The sculpt display
          is a preview; CAM uses the canonical U16 field and its own sampling.
        </p>
        <p className="lf-relief-note">
          Stock top is Z = 0. Component heights are measured above the relief floor. The surface has
          one height per XY point; undercuts and solid CAD are unsupported.
        </p>
      </details>
      <DialogActions>
        <Button title="Close the relief component editor" onClick={props.onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
