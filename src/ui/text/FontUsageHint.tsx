import { findFontEntry } from '../../core/text';

export function FontUsageHint({ fontKey }: { readonly fontKey: string }): JSX.Element | null {
  if (findFontEntry(fontKey)?.geometry !== 'single-line') return null;
  return (
    <small style={hintStyle}>
      CNC single-line font: use Engrave or Profile on path. Pocket, Fill, and V-carve require closed
      outline text.
      <span style={detailStyle}>
        Character coverage varies by face; unsupported characters become ?.
      </span>
    </small>
  );
}

const hintStyle: React.CSSProperties = {
  display: 'block',
  flexBasis: '100%',
  marginTop: 4,
  color: 'var(--lf-text-muted)',
};

const detailStyle: React.CSSProperties = {
  display: 'block',
};
