import { findFontEntry } from '../../core/text';

export function FontUsageHint(props: { readonly fontKey: string }): JSX.Element | null {
  if (findFontEntry(props.fontKey)?.geometry !== 'single-line') return null;
  return (
    <small style={hintStyle}>
      CNC single-line font: use an Engrave/on-path layer. V-carve requires closed outline text.
      {(props.fontKey.startsWith('ems-') || DECORATIVE_FORGE_FONTS.has(props.fontKey)) && (
        <span style={detailStyle}>
          Decorative strokes can have tight turns; verify the text size and bit diameter in Preview.
        </span>
      )}
    </small>
  );
}

const DECORATIVE_FORGE_FONTS = new Set([
  'forge-soft-cursive',
  'forge-swing',
  'forge-grace',
  'forge-grace-flourish',
  'forge-signature',
  'forge-romantic',
  'forge-copperplate',
  'forge-casual',
  'forge-friendly',
  'forge-signwriter',
  'forge-parisian',
  'forge-personal',
]);

const hintStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  color: 'var(--lf-text-muted)',
};

const detailStyle: React.CSSProperties = {
  display: 'block',
};
