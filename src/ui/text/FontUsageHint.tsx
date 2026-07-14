import { findFontEntry } from '../../core/text';

export function FontUsageHint(props: { readonly fontKey: string }): JSX.Element | null {
  if (findFontEntry(props.fontKey)?.geometry !== 'single-line') return null;
  return (
    <small style={hintStyle}>
      CNC single-line font: use an Engrave/on-path layer. V-carve requires closed outline text.
    </small>
  );
}

const hintStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  color: 'var(--lf-text-muted)',
};
