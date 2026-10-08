import { useState } from 'react';
import type { SceneObject, Transform, Vec2 } from '../../core/scene/scene-object';
import { IDENTITY_TRANSFORM } from '../../core/scene/scene-object';
import { applyTransform } from '../../core/scene/transform';
import type {
  ReliefAuthoringDocument,
  ReliefComponent,
} from '../../core/scene/relief/relief-authoring';
import type {
  ReliefProfileSection,
  ReliefRailProfileSource,
} from '../../core/scene/relief/relief-rail-profile';
import { openRailForRelief } from '../../core/relief/relief-rail-profile-links';
import { reviseReliefDocument } from '../../core/relief/relief-authoring-document';
import { NumberControl } from './ReliefComponentControls';

type CreationProps = {
  readonly document: ReliefAuthoringDocument;
  readonly vectors: ReadonlyArray<SceneObject>;
  readonly reliefTransform: Transform;
  readonly disabled: boolean;
  readonly prepare: (document: ReliefAuthoringDocument) => Promise<void>;
  readonly setSelectedId: (id: string) => void;
};
export function ReliefRailCreationControls(props: CreationProps): JSX.Element {
  const [railId, setRailId] = useState(props.vectors[0]?.id ?? '');
  const [secondId, setSecondId] = useState(''),
    [profileId, setProfileId] = useState('');
  const [width, setWidth] = useState(10),
    [height, setHeight] = useState(props.document.maxDepthMm / 2);
  const [message, setMessage] = useState('');
  const create = (): void => {
    try {
      const component = createdRailComponent(props, { railId, secondId, profileId, width, height });
      const id = component.id;
      props.setSelectedId(id);
      setMessage('');
      void props.prepare(
        reviseReliefDocument(props.document, {
          components: [...props.document.components, component],
        }),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Rail creation failed.');
    }
  };
  return (
    <fieldset disabled={props.disabled}>
      <legend>Rail and profile surface</legend>
      <VectorChoice
        label="First open rail"
        value={railId}
        setValue={setRailId}
        vectors={props.vectors}
      />
      <VectorChoice
        label="Second open rail"
        value={secondId}
        setValue={setSecondId}
        vectors={props.vectors}
        none="One centreline rail"
      />
      <VectorChoice
        label="Profile graph vector"
        value={profileId}
        setValue={setProfileId}
        vectors={props.vectors}
        none="Triangular profile"
      />
      <NumberControl label="Single rail width (mm)" value={width} commit={setWidth} />
      <NumberControl label="Profile peak height (mm)" value={height} commit={setHeight} />
      <p>
        Rails remain linked. Profile graphs retain a snapshot across normalized width. Two rails are
        paired by arc length; folded or crossing surfaces cannot be represented as one height per XY
        point.
      </p>
      <button
        title="Create a scalar relief surface from the selected rails and positioned profiles"
        type="button"
        onClick={create}
      >
        Create rail surface
      </button>
      {message ? <p role="status">{message}</p> : null}
    </fieldset>
  );
}
function VectorChoice(props: {
  readonly label: string;
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly vectors: ReadonlyArray<SceneObject>;
  readonly none?: string;
}): JSX.Element {
  return (
    <label style={{ display: 'block' }}>
      {props.label}{' '}
      <select
        title={props.label}
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.setValue(event.target.value)}
      >
        {props.none === undefined ? null : <option value="">{props.none}</option>}
        {props.vectors.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name ?? o.id}
          </option>
        ))}
      </select>
    </label>
  );
}
function profileFromVector(object: SceneObject, heightMm: number): ReliefProfileSection['profile'] {
  if (!('paths' in object)) throw new Error('A profile must be vector artwork.');
  const polylines = object.paths.flatMap((path) => path.polylines),
    line = polylines[0];
  if (polylines.length !== 1 || line === undefined || line.closed)
    throw new Error('A profile requires one open graph vector.');
  if (line.points.length < 2 || line.points.length > 64)
    throw new Error('Profile vector requires 2–64 graph points.');
  let points = line.points.map((p) => applyTransform(p, object.transform));
  points = increasingProfileDirection(points);
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  if (!(maxX > minX)) throw new Error('Profile must span a non-zero X width.');
  return points.map((p) => ({
    x: (p.x - minX) / (maxX - minX),
    y: maxY === minY ? heightMm : ((maxY - p.y) / (maxY - minY)) * heightMm,
  }));
}

export function ReliefRailSourceControls(props: {
  readonly component: ReliefComponent;
  readonly disabled: boolean;
  readonly onPatch: (patch: Partial<ReliefComponent>) => void;
}): JSX.Element | null {
  const source = props.component.source;
  if (source.kind !== 'rail-profile-v1') return null;
  const patch = (next: ReliefRailProfileSource): void => props.onPatch({ source: next });
  return (
    <fieldset disabled={props.disabled}>
      <legend>Positioned rail profiles</legend>
      <NumberControl
        label="Rail width (mm)"
        value={source.widthMm}
        commit={(widthMm) => patch({ ...source, widthMm })}
      />
      <NumberControl
        label="Rail sampling steps"
        value={source.samplingSteps}
        commit={(samplingSteps) => patch({ ...source, samplingSteps })}
      />
      <label>
        <input
          title="Reverse the first rail when matching positioned sections along the surface"
          type="checkbox"
          checked={source.rail.reversed ?? false}
          onChange={(event) =>
            patch({ ...source, rail: { ...source.rail, reversed: event.target.checked } })
          }
        />{' '}
        Reverse first rail
      </label>
      {source.secondRail === undefined ? null : (
        <label>
          <input
            title="Reverse the second rail when matching it to the first rail"
            type="checkbox"
            checked={source.secondRail.reversed ?? false}
            onChange={(event) => {
              if (source.secondRail !== undefined)
                patch({
                  ...source,
                  secondRail: { ...source.secondRail, reversed: event.target.checked },
                });
            }}
          />{' '}
          Reverse second rail
        </label>
      )}
      {source.sections.map((section, index) => (
        <ProfileSectionControl
          key={section.id}
          section={section}
          endpoint={index === 0 || index === source.sections.length - 1}
          update={(updated) =>
            patch({
              ...source,
              sections: source.sections
                .map((s) => (s.id === section.id ? updated : s))
                .sort((a, b) => a.position - b.position),
            })
          }
          remove={() =>
            patch({ ...source, sections: source.sections.filter((s) => s.id !== section.id) })
          }
        />
      ))}
      <button
        title="Add a profile section at a position along the rails"
        type="button"
        disabled={source.sections.length >= 32}
        onClick={() => patch({ ...source, sections: insertSection(source.sections) })}
      >
        Add positioned section
      </button>
    </fieldset>
  );
}
function ProfileSectionControl(props: {
  readonly section: ReliefProfileSection;
  readonly endpoint: boolean;
  readonly update: (section: ReliefProfileSection) => void;
  readonly remove: () => void;
}): JSX.Element {
  const section = props.section;
  return (
    <fieldset>
      <legend>Section at {Math.round(section.position * 100)}%</legend>
      {props.endpoint ? (
        <p>Rail endpoint {section.position}</p>
      ) : (
        <NumberControl
          label="Section position (0–1)"
          value={section.position}
          commit={(position) => props.update({ ...section, position })}
        />
      )}
      <NumberControl
        label="Section width scale"
        value={section.widthScale}
        commit={(widthScale) => props.update({ ...section, widthScale })}
      />
      <details>
        <summary title="Edit normalized profile positions and physical heights above the relief floor">
          Profile height points
        </summary>
        {section.profile.map((point, index) => (
          <NumberControl
            key={index}
            label={`Height at ${Math.round(point.x * 100)}% width (mm)`}
            value={point.y}
            commit={(y) =>
              props.update({
                ...section,
                profile: section.profile.map((p, i) => (i === index ? { ...p, y } : p)),
              })
            }
          />
        ))}
      </details>
      {props.endpoint ? null : (
        <button title="Remove this positioned profile section" type="button" onClick={props.remove}>
          Remove section
        </button>
      )}
    </fieldset>
  );
}
function insertSection(
  sections: ReadonlyArray<ReliefProfileSection>,
): ReadonlyArray<ReliefProfileSection> {
  let chosen = 1,
    width = 0;
  for (let i = 1; i < sections.length; i += 1) {
    const gap = (sections[i]?.position ?? 0) - (sections[i - 1]?.position ?? 0);
    if (gap > width) {
      width = gap;
      chosen = i;
    }
  }
  const left = sections[chosen - 1],
    right = sections[chosen];
  if (left === undefined || right === undefined) return sections;
  return [
    ...sections,
    {
      ...left,
      id: crypto.randomUUID(),
      position: (left.position + right.position) / 2,
      widthScale: (left.widthScale + right.widthScale) / 2,
    },
  ].sort((a, b) => a.position - b.position);
}

function createdRailComponent(
  props: CreationProps,
  values: { railId: string; secondId: string; profileId: string; width: number; height: number },
): ReliefComponent {
  const object = props.vectors.find((o) => o.id === values.railId),
    second = props.vectors.find((o) => o.id === values.secondId),
    profile = props.vectors.find((o) => o.id === values.profileId);
  if (object === undefined) throw new Error('Choose one open rail vector.');
  const graph =
    profile === undefined
      ? [
          { x: 0, y: 0 },
          { x: 0.5, y: values.height },
          { x: 1, y: 0 },
        ]
      : profileFromVector(profile, values.height);
  const source: ReliefRailProfileSource = {
    kind: 'rail-profile-v1',
    rail: openRailForRelief(object, props.reliefTransform),
    ...(second === undefined
      ? {}
      : { secondRail: openRailForRelief(second, props.reliefTransform) }),
    widthMm: values.width,
    samplingSteps: 32,
    sections: [
      { id: crypto.randomUUID(), position: 0, widthScale: 1, profile: graph },
      { id: crypto.randomUUID(), position: 1, widthScale: 1, profile: graph },
    ],
  };
  const id = crypto.randomUUID();
  const component: ReliefComponent = {
    id,
    name: second === undefined ? 'Rail and profile' : 'Two rails and profiles',
    levelId: props.document.levels[0]?.id ?? 'level-1',
    visible: true,
    combineMode: 'max',
    transform: IDENTITY_TRANSFORM,
    baseHeightMm: 0,
    heightScale: 1,
    source,
  };
  return component;
}

function increasingProfileDirection(points: ReadonlyArray<Vec2>): Array<Vec2> {
  const first = points[0],
    last = points[points.length - 1];
  return first !== undefined && last !== undefined && first.x > last.x
    ? [...points].reverse()
    : [...points];
}
