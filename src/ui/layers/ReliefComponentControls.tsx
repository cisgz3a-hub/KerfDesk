import type {
  ReliefAuthoringDocument,
  ReliefComponent,
  ReliefVectorMask,
} from '../../core/scene/relief/relief-authoring';
import type { SceneObject, Transform } from '../../core/scene/scene-object';
import { applyTransform } from '../../core/scene/transform';
import { IDENTITY_TRANSFORM } from '../../core/scene/scene-object';
import {
  inverseReliefPoint,
  reliefBoundarySizeError,
} from '../../core/relief/relief-vector-boundary';

export function vectorMaskForRelief(
  object: SceneObject,
  reliefTransform: Transform,
  componentTransform?: Transform,
): ReliefVectorMask {
  if (!('paths' in object)) return { rings: [] };
  const polylines = object.paths.flatMap((path) => path.polylines);
  // Validation discloses oversized input without first copying its coordinates.
  if (reliefBoundarySizeError(polylines) !== null) return { rings: polylines };
  return {
    linkedObjectId: object.id,
    linkComponentTransform: componentTransform ?? IDENTITY_TRANSFORM,
    rings: polylines.map((ring) => ({
      closed: ring.closed,
      points: ring.points.map((p) => {
        const local = inverseReliefPoint(applyTransform(p, object.transform), reliefTransform);
        return componentTransform === undefined
          ? local
          : inverseReliefPoint(local, componentTransform);
      }),
    })),
  };
}

// Declarative form chrome and its modal-owned handlers stay together; pure composition and stroke algorithms are independently tested.
// eslint-disable-next-line max-lines-per-function
export function ReliefComponentControls(props: {
  readonly component: ReliefComponent;
  readonly document: ReliefAuthoringDocument;
  readonly vectors: ReadonlyArray<SceneObject>;
  readonly reliefTransform: Transform;
  readonly disabled: boolean;
  readonly onPatch: (patch: Partial<ReliefComponent>) => void;
  readonly onClip: (mask: ReliefVectorMask | null) => void;
}): JSX.Element {
  const c = props.component;
  return (
    <fieldset disabled={props.disabled}>
      <legend>Selected component</legend>
      <label>
        Name{' '}
        <input
          title="Name this retained relief component"
          key={`${c.id}:${c.name}`}
          defaultValue={c.name}
          aria-label="Relief component name"
          onBlur={(e) => {
            if (e.target.value !== c.name) props.onPatch({ name: e.target.value });
          }}
        />
      </label>
      <label>
        <input
          title="Include this component in the composed relief field"
          type="checkbox"
          checked={c.visible}
          onChange={(e) => props.onPatch({ visible: e.target.checked })}
        />{' '}
        Visible
      </label>
      <label>
        Level{' '}
        <select
          title="Choose the ordered composition level for this component"
          value={c.levelId}
          aria-label="Relief component level"
          onChange={(e) => props.onPatch({ levelId: e.target.value })}
        >
          {props.document.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Combine{' '}
        <select
          title="Choose how this component combines with the accumulated relief height"
          aria-label="Relief combine mode"
          value={c.combineMode}
          onChange={(e) =>
            props.onPatch({ combineMode: e.target.value as ReliefComponent['combineMode'] })
          }
        >
          <option value="add">Add to baseline</option>
          <option value="subtract">Subtract from baseline</option>
          <option value="max">Keep highest</option>
          <option value="min">Keep lowest</option>
          <option value="replace">Replace inside coverage</option>
        </select>
      </label>
      <NumberControl
        label="Component base above floor (mm)"
        value={c.baseHeightMm}
        commit={(baseHeightMm) => props.onPatch({ baseHeightMm })}
      />
      <NumberControl
        label="Component height scale"
        value={c.heightScale}
        commit={(heightScale) => props.onPatch({ heightScale })}
      />
      {c.source.kind === 'vector-shape-v1' ? (
        <>
          <label>
            Profile{' '}
            <select
              title="Choose a plane, elliptical dome cap or linear slope inside the vector boundary"
              aria-label="Relief shape profile"
              value={c.source.profile}
              onChange={(e) => {
                if (c.source.kind === 'vector-shape-v1')
                  props.onPatch({
                    source: { ...c.source, profile: e.target.value as 'plane' | 'dome' | 'slope' },
                  });
              }}
            >
              <option value="plane">Plane</option>
              <option value="dome">Elliptical dome cap</option>
              <option value="slope">Linear slope</option>
            </select>
          </label>
          <NumberControl
            label="Shape height (mm)"
            value={c.source.heightMm}
            commit={(heightMm) => {
              if (c.source.kind === 'vector-shape-v1')
                props.onPatch({ source: { ...c.source, heightMm } });
            }}
          />
          <NumberControl
            label="Slope direction (degrees)"
            value={c.source.angleDeg}
            commit={(angleDeg) => {
              if (c.source.kind === 'vector-shape-v1')
                props.onPatch({ source: { ...c.source, angleDeg } });
            }}
          />
        </>
      ) : (
        <p>
          {c.source.kind === 'retained-field-v1'
            ? 'Original U16 source and mapping retained.'
            : 'Scalar rail source and positioned profiles retained.'}
        </p>
      )}
      <details className="lf-relief-advanced">
        <summary>Component placement and clip</summary>
        {(['x', 'y', 'scaleX', 'scaleY', 'rotationDeg'] as const).map((key) => (
          <NumberControl
            key={key}
            label={`Component ${key}`}
            value={c.transform[key]}
            commit={(value) => props.onPatch({ transform: { ...c.transform, [key]: value } })}
          />
        ))}
        <label>
          Linked clip{' '}
          <select
            title="Clip this component to a live linked closed-vector boundary"
            value={c.mask?.linkedObjectId ?? ''}
            aria-label="Relief component linked clip"
            onChange={(e) => {
              const object = props.vectors.find((v) => v.id === e.target.value);
              props.onClip(
                object === undefined
                  ? null
                  : vectorMaskForRelief(object, props.reliefTransform, c.transform),
              );
            }}
          >
            <option value="">No linked clip</option>
            {props.vectors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name ?? v.id}
              </option>
            ))}
          </select>
        </label>
      </details>
    </fieldset>
  );
}

export function NumberControl(props: {
  readonly label: string;
  readonly value: number;
  readonly commit: (value: number) => void;
}): JSX.Element {
  return (
    <label className="lf-relief-number-control">
      {props.label}{' '}
      <input
        title={props.label}
        key={props.value}
        type="number"
        step="any"
        defaultValue={props.value}
        aria-label={props.label}
        onBlur={(event) => {
          const raw = event.currentTarget.value.trim();
          const value = Number(raw);
          event.currentTarget.value = String(props.value);
          if (raw !== '' && Number.isFinite(value) && value !== props.value) props.commit(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.currentTarget.value = String(props.value);
            event.stopPropagation();
          }
        }}
      />
    </label>
  );
}
