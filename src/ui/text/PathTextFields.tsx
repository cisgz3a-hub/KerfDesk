import type { PathTextSettings, SceneObject } from '../../core/scene';
import { NumberField } from '../common/NumberField';

export function PathTextFields(props: {
  readonly enabled: boolean;
  readonly guides: ReadonlyArray<SceneObject>;
  readonly settings: PathTextSettings;
  readonly setEnabled: (enabled: boolean) => void;
  readonly setGuideId: (id: string) => void;
  readonly setOffsetMm: (offset: number) => void;
  readonly setReverse: (reverse: boolean) => void;
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
          <label className="lf-field">
            <span className="lf-field-label lf-field-label--sm">Guide</span>
            <select
              className="lf-select"
              value={props.settings.guideObjectId}
              onChange={(event) => props.setGuideId(event.target.value)}
              aria-label="Text path guide"
              title="Choose the vector path that the text follows."
            >
              {props.guides.map((guide) => (
                <option key={guide.id} value={guide.id}>
                  {guideLabel(guide)}
                </option>
              ))}
            </select>
          </label>
          <label className="lf-field">
            <span className="lf-field-label lf-field-label--sm">Path offset</span>
            <NumberField
              ariaLabel="Text path offset"
              value={props.settings.offsetMm}
              min={0}
              max={100_000}
              step={1}
              onCommit={props.setOffsetMm}
              title="Distance from the beginning of the guide path."
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

function guideLabel(guide: SceneObject): string {
  if (guide.kind === 'imported-svg' || guide.kind === 'traced-image') return guide.source;
  if (guide.kind === 'text') return guide.content;
  if (guide.kind === 'shape') return `${guide.spec.kind} (${guide.id})`;
  return guide.id;
}
