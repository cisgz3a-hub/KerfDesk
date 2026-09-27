import type { PathTextSettings, SceneObject } from '../../core/scene';
import type { PathTextAcrossAlign, PathTextAlongAlign } from '../../core/scene/scene-object';
import { NumberField } from '../common/NumberField';

const ALONG_OPTIONS: ReadonlyArray<{ readonly value: PathTextAlongAlign; readonly label: string }> =
  [
    { value: 'start', label: 'Start of path' },
    { value: 'middle', label: 'Middle of path' },
    { value: 'end', label: 'End of path' },
  ];

const ACROSS_OPTIONS: ReadonlyArray<{
  readonly value: PathTextAcrossAlign;
  readonly label: string;
}> = [
  { value: 'above', label: 'On top of the path' },
  { value: 'center', label: 'Centred on the path' },
  { value: 'below', label: 'Hanging below the path' },
];

export function PathTextFields(props: {
  readonly enabled: boolean;
  readonly guides: ReadonlyArray<SceneObject>;
  readonly settings: PathTextSettings;
  readonly setEnabled: (enabled: boolean) => void;
  readonly setGuideId: (id: string) => void;
  readonly setOffsetMm: (offset: number) => void;
  readonly setReverse: (reverse: boolean) => void;
  readonly setAlongAlign: (align: PathTextAlongAlign) => void;
  readonly setAcrossAlign: (align: PathTextAcrossAlign) => void;
}): JSX.Element {
  return (
    <>
      <label className="lf-field">
        <span className="lf-field-label lf-field-label--sm">Path text</span>
        <input
          type="checkbox"
          checked={props.enabled}
          disabled={props.guides.length === 0}
          onChange={(event) => props.setEnabled(event.target.checked)}
          title="Place text along a selected vector path."
        />
      </label>
      {props.enabled && (
        <>
          <ChoiceField
            label="Guide"
            ariaLabel="Text path guide"
            title="Choose the vector path that the text follows."
            value={props.settings.guideObjectId}
            options={props.guides.map((guide) => ({ value: guide.id, label: guideLabel(guide) }))}
            onChange={props.setGuideId}
          />
          <ChoiceField
            label="Place at"
            ariaLabel="Text position along the path"
            title="Where the text sits along the guide. The offset moves it away from that point."
            value={props.settings.alongAlign ?? 'start'}
            options={ALONG_OPTIONS}
            onChange={props.setAlongAlign}
          />
          <ChoiceField
            label="Text sits"
            ariaLabel="Text position across the path"
            title="Whether the path runs under the text, through its middle, or over its top."
            value={props.settings.acrossAlign ?? 'above'}
            options={ACROSS_OPTIONS}
            onChange={props.setAcrossAlign}
          />
          <label className="lf-field">
            <span className="lf-field-label lf-field-label--sm">Path offset</span>
            <NumberField
              ariaLabel="Text path offset"
              value={props.settings.offsetMm}
              min={0}
              max={100_000}
              step={1}
              onCommit={props.setOffsetMm}
              title="Distance from the chosen point: forward from the start or middle, back from the end."
              debounceMs={0}
            />
            <span className="lf-field-unit">mm</span>
          </label>
          <label className="lf-field">
            <span className="lf-field-label lf-field-label--sm">Direction</span>
            <input
              type="checkbox"
              checked={props.settings.reverse}
              onChange={(event) => props.setReverse(event.target.checked)}
              title="Reverse text direction along the guide."
            />
            <span>Reverse</span>
          </label>
        </>
      )}
    </>
  );
}

function ChoiceField<T extends string>(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly title: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly onChange: (value: T) => void;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--sm">{props.label}</span>
      <select
        className="lf-select"
        value={props.value}
        onChange={(event) =>
          props.onChange(
            props.options.find((option) => option.value === event.target.value)?.value ??
              props.value,
          )
        }
        aria-label={props.ariaLabel}
        title={props.title}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function guideLabel(guide: SceneObject): string {
  if (guide.kind === 'imported-svg' || guide.kind === 'traced-image') return guide.source;
  if (guide.kind === 'text') return guide.content;
  if (guide.kind === 'shape') return `${guide.spec.kind} (${guide.id})`;
  return guide.id;
}
