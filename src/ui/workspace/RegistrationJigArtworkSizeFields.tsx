import { IconButton } from '../kit';

/** The shared artwork size (ADR-057 2026-08-25, ADR-638): W and H apply on
 *  Enter or when the field is left, and one lock keeps the proportions. */
export function RegistrationJigArtworkSizeFields(props: {
  readonly count: number;
  readonly heightDraft: string;
  readonly isAspectLocked: boolean;
  readonly usesArtworkAxes: boolean;
  readonly widthDraft: string;
  readonly onApply: () => void;
  readonly onHeightChange: (value: string) => void;
  readonly onToggleAspect: () => void;
  readonly onWidthChange: (value: string) => void;
}): JSX.Element {
  const scope = props.count === 1 ? 'artwork' : `artwork on all ${props.count} pieces`;
  const widthTitle = props.isAspectLocked
    ? `Width of the ${scope}; the height follows. Applies on Enter or when you leave the field.`
    : `Width of the ${scope}. Applies on Enter or when you leave the field.`;
  const heightTitle = props.isAspectLocked
    ? `Height of the ${scope}; the width follows. Applies on Enter or when you leave the field.`
    : `Height of the ${scope}. Applies on Enter or when you leave the field.`;
  const applyOnEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };
  return (
    <fieldset aria-label="Jig artwork size" style={fieldsetStyle}>
      <legend style={legendStyle}>
        {props.count === 1 ? 'Artwork size' : `Size on every piece (${props.count})`}
      </legend>
      <div style={rowStyle}>
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
            onBlur={props.onApply}
            onKeyDown={applyOnEnter}
          />
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
            onBlur={props.onApply}
            onKeyDown={applyOnEnter}
          />
        </label>
        <span style={hintStyle}>mm</span>
        <IconButton
          icon={props.isAspectLocked ? 'lock' : 'unlock'}
          label="Keep proportions"
          title={
            props.isAspectLocked
              ? 'Proportions kept: changing W or H changes the other. Click to set them separately.'
              : 'W and H are set separately. Click to keep the proportions.'
          }
          pressed={props.isAspectLocked}
          size="sm"
          onClick={props.onToggleAspect}
        />
      </div>
      {!props.isAspectLocked && props.usesArtworkAxes && (
        <span style={hintStyle}>W and H follow the artwork&apos;s own rotated axes.</span>
      )}
    </fieldset>
  );
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  display: 'grid',
  gap: 6,
  margin: 0,
  padding: 8,
};

const legendStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', padding: '0 4px' };
const rowStyle: React.CSSProperties = { alignItems: 'center', display: 'flex', gap: 6 };
const fieldStyle: React.CSSProperties = {
  alignItems: 'center',
  display: 'grid',
  flex: 1,
  gap: 4,
  gridTemplateColumns: 'auto minmax(0, 1fr)',
};
const hintStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
