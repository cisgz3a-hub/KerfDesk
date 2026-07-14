import type { TextLayerNotice, TextLayerOption } from './text-layer-options';

export function TextLayerField(props: {
  readonly value: string;
  readonly options: ReadonlyArray<TextLayerOption>;
  readonly notice?: TextLayerNotice;
  readonly onChange: (color: string) => void;
}): JSX.Element {
  return (
    <label className="lf-field" style={{ alignItems: 'flex-start' }}>
      <span className="lf-field-label lf-field-label--sm" style={{ paddingTop: 4 }}>
        Output layer
      </span>
      <span style={{ flex: 1, display: 'grid', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: props.value,
              border: '1px solid var(--border)',
            }}
          />
          <select
            className="lf-input"
            aria-label="Text output layer"
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            style={{ flex: 1 }}
          >
            {props.options.map((option) => (
              <option
                key={`${option.color}:${option.isNew ? 'new' : 'existing'}`}
                value={option.color}
              >
                {option.label} ({option.color}) — {option.summary}
              </option>
            ))}
          </select>
        </span>
        {props.notice !== undefined && (
          <span
            role={props.notice.kind === 'error' ? 'alert' : 'status'}
            style={{
              fontSize: 11,
              color: props.notice.kind === 'error' ? 'var(--danger)' : 'var(--warning)',
            }}
          >
            {props.notice.message}
          </span>
        )}
      </span>
    </label>
  );
}
