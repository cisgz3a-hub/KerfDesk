import { Button } from '../kit';

export function RegistrationJigArtworkSizeFields(props: {
  readonly count: number;
  readonly heightDraft: string;
  readonly isAspectLocked: boolean;
  readonly widthDraft: string;
  readonly onApply: () => void;
  readonly onHeightChange: (value: string) => void;
  readonly onToggleAspect: () => void;
  readonly onWidthChange: (value: string) => void;
}): JSX.Element {
  const widthTitle = props.isAspectLocked
    ? 'Set the shared artwork width; height stays proportional'
    : 'Set the shared artwork width independently';
  const heightTitle = props.isAspectLocked
    ? 'Set the shared artwork height; width stays proportional'
    : 'Set the shared artwork height independently';
  return (
    <fieldset aria-label="Jig artwork size" style={fieldsetStyle}>
      <legend style={legendStyle}>Artwork size — all {props.count} copies</legend>
      <div style={fieldsStyle}>
        <label style={fieldStyle}>
          <span>W</span>
          <input
            className="lf-input"
            aria-label="Jig artwork width"
            title={widthTitle}
            type="number"
            min="0.001"
            step="0.1"
            value={props.widthDraft}
            onInput={(event) => props.onWidthChange(event.currentTarget.value)}
          />
          <span>mm</span>
        </label>
        <label style={fieldStyle}>
          <span>H</span>
          <input
            className="lf-input"
            aria-label="Jig artwork height"
            title={heightTitle}
            type="number"
            min="0.001"
            step="0.1"
            value={props.heightDraft}
            onInput={(event) => props.onHeightChange(event.currentTarget.value)}
          />
          <span>mm</span>
        </label>
      </div>
      <div style={aspectRowStyle}>
        <Button
          pressed={props.isAspectLocked}
          title={props.isAspectLocked ? 'Unlock width and height' : 'Lock artwork proportions'}
          onClick={props.onToggleAspect}
        >
          {props.isAspectLocked ? 'AR locked' : 'AR unlocked'}
        </Button>
        <span style={aspectHintStyle}>
          {props.isAspectLocked ? 'proportions preserved' : 'W and H are independent'}
        </span>
      </div>
      <Button onClick={props.onApply}>Apply size to all {props.count}</Button>
    </fieldset>
  );
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: 8,
};

const legendStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', padding: '0 4px' };
const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const fieldStyle: React.CSSProperties = {
  alignItems: 'center',
  display: 'grid',
  gap: 4,
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
};
const aspectRowStyle: React.CSSProperties = { alignItems: 'center', display: 'flex', gap: 8 };
const aspectHintStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
