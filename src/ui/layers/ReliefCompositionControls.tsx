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

type Props = {
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
};
export function ReliefCompositionControls(props: Props): JSX.Element {
  return (
    <>
      <ReliefComponentList {...props} />
      <fieldset disabled={props.disabled}>
        <legend>Add vector shape</legend>
        <label>
          Closed vector
          <select
            title="Choose a closed vector boundary for a new relief shape"
            aria-label="Vector relief boundary"
            value={props.vectorId}
            onChange={(event) => props.setVectorId(event.currentTarget.value)}
          >
            {props.vectors.length === 0 ? (
              <option value="">No closed vectors in this sheet</option>
            ) : (
              props.vectors.map((vector) => (
                <option key={vector.id} value={vector.id}>
                  {vector.name ?? vector.id}
                </option>
              ))
            )}
          </select>
        </label>
        <label>
          Height profile
          <select
            title="Choose the height profile for the new vector-derived relief shape"
            aria-label="New relief shape profile"
            value={props.profile}
            onChange={(event) => props.setProfile(event.currentTarget.value as Props['profile'])}
          >
            <option value="plane">Plane</option>
            <option value="dome">Elliptical dome cap</option>
            <option value="slope">Linear slope</option>
          </select>
        </label>
        <button
          title="Create a linked scalar relief shape inside the chosen vector boundary"
          type="button"
          disabled={props.vectors.length === 0}
          onClick={props.addShape}
        >
          Create shape from vector
        </button>
        {props.vectors.length === 0 ? (
          <p className="lf-relief-note">
            Draw a closed rectangle, ellipse or path on the sheet to use it as a relief shape. The
            base component can be sculpted without vectors.
          </p>
        ) : null}
      </fieldset>
      <details className="lf-relief-advanced">
        <summary>Composition settings and levels</summary>
        <ReliefCompositionSettings {...props} />
      </details>
    </>
  );
}
function ReliefComponentList(props: Props): JSX.Element {
  const { document, selected } = props;
  const copyField = (): void => {
    const id = crypto.randomUUID();
    props.setSelectedId(id);
    void props.prepare(
      reviseReliefDocument(document, {
        components: [
          ...document.components,
          bakeReliefComponent(props.field, id, document.levels[0]?.id ?? 'level-1'),
        ],
      }),
    );
  };
  return (
    <fieldset disabled={props.disabled}>
      <legend>Components</legend>
      <label>
        Edit and sculpt
        <select
          title="Choose the relief component to edit or sculpt"
          aria-label="Selected relief component"
          value={selected?.id ?? ''}
          onChange={(event) => props.setSelectedId(event.currentTarget.value)}
        >
          {document.components.length === 0 ? (
            <option value="">No components</option>
          ) : (
            document.components.map((component) => (
              <option key={component.id} value={component.id}>
                {component.name}
              </option>
            ))
          )}
        </select>
      </label>
      <div className="lf-relief-component-actions">
        <button
          title="Duplicate the selected component and its retained sculpt strokes"
          type="button"
          disabled={selected === undefined}
          onClick={() => duplicateComponent(props)}
        >
          Duplicate component
        </button>
        <button
          title="Remove the selected component and its retained sculpt strokes"
          type="button"
          disabled={selected === undefined}
          onClick={() => {
            if (selected !== undefined)
              void props.prepare(
                reviseReliefDocument(document, {
                  components: document.components.filter(
                    (component) => component.id !== selected.id,
                  ),
                  strokes: document.strokes.filter((stroke) => stroke.componentId !== selected.id),
                }),
              );
          }}
        >
          Remove component
        </button>
        <button
          title="Add a detached copy of the current canonical heightfield as a sculptable component"
          type="button"
          onClick={copyField}
        >
          {selected === undefined ? 'Add sculpting base' : 'Bake field copy'}
        </button>
      </div>
    </fieldset>
  );
}
function ReliefCompositionSettings(props: Props): JSX.Element {
  const { document } = props;
  return (
    <fieldset disabled={props.disabled}>
      <legend>Composition</legend>
      <NumberControl
        label="Baseline above floor (mm)"
        value={document.baselineHeightMm}
        commit={(baselineHeightMm) => {
          void props.prepare(reviseReliefDocument(document, { baselineHeightMm }));
        }}
      />
      <NumberControl
        label="Authoring grid width (cells)"
        value={document.width}
        commit={(width) => {
          void props.prepare(reviseReliefDocument(document, { width }));
        }}
      />
      <NumberControl
        label="Authoring grid height (cells)"
        value={document.height}
        commit={(height) => {
          void props.prepare(reviseReliefDocument(document, { height }));
        }}
      />
      <label>
        Outside clip
        <select
          title="Choose how cells outside the clip are treated"
          aria-label="Relief composition outside mask"
          value={document.outsideMask}
          onChange={(event) => {
            void props.prepare(
              reviseReliefDocument(document, {
                outsideMask: event.currentTarget.value as ReliefAuthoringDocument['outsideMask'],
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
        Composition clip
        <select
          title="Clip the complete composition to a live linked vector boundary"
          aria-label="Relief composition linked clip"
          value={document.clip?.linkedObjectId ?? ''}
          onChange={(event) => props.setGlobalClip(event.currentTarget.value)}
        >
          <option value="">No clip</option>
          {props.vectors.map((vector) => (
            <option key={vector.id} value={vector.id}>
              {vector.name ?? vector.id}
            </option>
          ))}
        </select>
      </label>
      <ReliefCompositionLevels {...props} />
    </fieldset>
  );
}

function duplicateComponent(props: Props): void {
  const { document, selected } = props;
  if (selected === undefined) return;
  const id = crypto.randomUUID();
  props.setSelectedId(id);
  void props.prepare(
    reviseReliefDocument(document, {
      components: [...document.components, { ...selected, id, name: `${selected.name} copy` }],
      strokes: [
        ...document.strokes,
        ...document.strokes
          .filter((stroke) => stroke.componentId === selected.id)
          .map((stroke) => ({ ...stroke, id: crypto.randomUUID(), componentId: id })),
      ],
    }),
  );
}
function ReliefCompositionLevels(props: Props): JSX.Element {
  const { document } = props;
  return (
    <>
      <button
        title="Add another ordered relief composition level"
        type="button"
        onClick={() => {
          void props.prepare(
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
        <label key={level.id}>
          <input
            title={`Include level ${level.name} in the composed relief field`}
            type="checkbox"
            checked={level.visible}
            onChange={(event) => {
              void props.prepare(
                reviseReliefDocument(document, {
                  levels: document.levels.map((item) =>
                    item.id === level.id ? { ...item, visible: event.currentTarget.checked } : item,
                  ),
                }),
              );
            }}
          />{' '}
          {level.name}
        </label>
      ))}
    </>
  );
}
