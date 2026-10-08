import type { SceneObject } from '../../core/scene/scene-object';
import type { ReliefHeightfield } from '../../core/scene/relief/relief-heightfield';
import type {
  ReliefAuthoringDocument,
  ReliefComponent,
} from '../../core/scene/relief/relief-authoring';
import {
  bakeReliefComponent,
  reviseReliefDocument,
} from '../../core/relief/relief-authoring-document';
import { NumberControl } from './ReliefComponentControls';

// Declarative form chrome and its modal-owned handlers stay together; pure composition and stroke algorithms are independently tested.
// eslint-disable-next-line max-lines-per-function
export function ReliefCompositionControls(props: {
  readonly document: ReliefAuthoringDocument;
  readonly selected: ReliefComponent | undefined;
  readonly field: ReliefHeightfield;
  readonly disabled: boolean;
  readonly vectors: ReadonlyArray<SceneObject>;
  readonly vectorId: string;
  readonly profile: 'plane' | 'dome' | 'slope';
  readonly setVectorId: (id: string) => void;
  readonly setProfile: (value: 'plane' | 'dome' | 'slope') => void;
  readonly setSelectedId: (id: string) => void;
  readonly setGlobalClip: (id: string) => void;
  readonly addShape: () => void;
  readonly prepare: (document: ReliefAuthoringDocument) => Promise<void>;
}): JSX.Element {
  const {
    document,
    selected,
    disabled,
    vectors,
    vectorId,
    profile,
    setVectorId,
    setProfile,
    setSelectedId,
    setGlobalClip,
    addShape,
    prepare,
  } = props;
  return (
    <fieldset disabled={disabled}>
      <legend>Composition</legend>
      <NumberControl
        label="Baseline above floor (mm)"
        value={document.baselineHeightMm}
        commit={(baselineHeightMm) => {
          void prepare(reviseReliefDocument(document, { baselineHeightMm }));
        }}
      />
      <NumberControl
        label="Authoring grid width (cells)"
        value={document.width}
        commit={(width) => {
          void prepare(reviseReliefDocument(document, { width }));
        }}
      />
      <NumberControl
        label="Authoring grid height (cells)"
        value={document.height}
        commit={(height) => {
          void prepare(reviseReliefDocument(document, { height }));
        }}
      />
      <label>
        Outside clip{' '}
        <select
          title="Choose whether cells outside the clip are excluded, kept at stock top or carved to the floor"
          aria-label="Relief composition outside mask"
          value={document.outsideMask}
          onChange={(e) => {
            void prepare(
              reviseReliefDocument(document, {
                outsideMask: e.target.value as ReliefAuthoringDocument['outsideMask'],
              }),
            );
          }}
        >
          <option value="excluded">Excluded from carving</option>
          <option value="stock-top">Keep stock top</option>
          <option value="relief-floor">Carve to floor</option>
        </select>
      </label>
      <label>
        Composition clip{' '}
        <select
          title="Clip the complete composition to a live linked vector boundary"
          aria-label="Relief composition linked clip"
          value={document.clip?.linkedObjectId ?? ''}
          onChange={(e) => setGlobalClip(e.target.value)}
        >
          <option value="">No clip</option>
          {vectors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name ?? v.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Component{' '}
        <select
          title="Choose the relief component to edit or sculpt"
          aria-label="Selected relief component"
          value={selected?.id ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {document.components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button
        title="Duplicate the selected component and its retained sculpt strokes"
        type="button"
        disabled={selected === undefined}
        onClick={() => {
          if (selected !== undefined) {
            const id = crypto.randomUUID();
            setSelectedId(id);
            void prepare(
              reviseReliefDocument(document, {
                components: [
                  ...document.components,
                  { ...selected, id, name: `${selected.name} copy` },
                ],
                strokes: [
                  ...document.strokes,
                  ...document.strokes
                    .filter((s) => s.componentId === selected.id)
                    .map((s) => ({ ...s, id: crypto.randomUUID(), componentId: id })),
                ],
              }),
            );
          }
        }}
      >
        Duplicate component
      </button>
      <button
        title="Add a detached copy of the current canonical heightfield as a component"
        type="button"
        onClick={() => {
          const id = crypto.randomUUID();
          setSelectedId(id);
          void prepare(
            reviseReliefDocument(document, {
              components: [
                ...document.components,
                bakeReliefComponent(props.field, id, document.levels[0]?.id ?? 'level-1'),
              ],
            }),
          );
        }}
      >
        Bake field copy
      </button>
      <button
        title="Remove the selected component and its retained sculpt strokes"
        type="button"
        disabled={selected === undefined}
        onClick={() => {
          if (selected !== undefined)
            void prepare(
              reviseReliefDocument(document, {
                components: document.components.filter((c) => c.id !== selected.id),
                strokes: document.strokes.filter((s) => s.componentId !== selected.id),
              }),
            );
        }}
      >
        Remove component
      </button>
      <label>
        Vector{' '}
        <select
          title="Choose a closed vector boundary for a new relief shape"
          aria-label="Vector relief boundary"
          value={vectorId}
          onChange={(e) => setVectorId(e.target.value)}
        >
          {vectors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name ?? v.id}
            </option>
          ))}
        </select>
      </label>
      <select
        title="Choose the height profile for the new vector-derived relief shape"
        aria-label="New relief shape profile"
        value={profile}
        onChange={(e) => setProfile(e.target.value as 'plane' | 'dome' | 'slope')}
      >
        <option value="plane">Plane</option>
        <option value="dome">Elliptical dome cap</option>
        <option value="slope">Linear slope</option>
      </select>
      <button
        title="Create a linked scalar relief shape inside the chosen vector boundary"
        type="button"
        onClick={addShape}
      >
        Create shape from vector
      </button>
      <button
        title="Add another ordered relief composition level"
        type="button"
        onClick={() => {
          void prepare(
            reviseReliefDocument(document, {
              levels: [
                ...document.levels,
                {
                  id: crypto.randomUUID(),
                  name: `Level ${document.levels.length + 1}`,
                  visible: true,
                },
              ],
            }),
          );
        }}
      >
        Add level
      </button>
      {document.levels.map((level) => (
        <label key={level.id} style={{ display: 'block' }}>
          <input
            title={'Include level ' + level.name + ' in the composed relief field'}
            type="checkbox"
            checked={level.visible}
            onChange={(e) => {
              void prepare(
                reviseReliefDocument(document, {
                  levels: document.levels.map((l) =>
                    l.id === level.id ? { ...l, visible: e.target.checked } : l,
                  ),
                }),
              );
            }}
          />{' '}
          {level.name}
        </label>
      ))}
    </fieldset>
  );
}
