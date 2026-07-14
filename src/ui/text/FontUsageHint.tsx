import { findFontEntry } from '../../core/text';

export function FontUsageHint(props: { readonly fontKey: string }): JSX.Element | null {
  if (findFontEntry(props.fontKey)?.geometry !== 'single-line') return null;
  return (
    <small style={hintStyle}>
      CNC single-line font: use an Engrave/on-path layer. V-carve requires closed outline text.
      {props.fontKey.startsWith('ems-') && (
        <span style={detailStyle}>
          Decorative strokes can have tight turns; verify the text size and bit diameter in Preview.
        </span>
      )}
    </small>
  );
}

const hintStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  color: 'var(--lf-text-muted)',
};

const detailStyle: React.CSSProperties = {
  display: 'block',
};
