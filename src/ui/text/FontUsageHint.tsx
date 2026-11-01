import type { EmbeddedFont } from '../../core/scene';
import { findFontEntry } from '../../core/text';
import { missingCharactersSentence } from '../../core/text/missing-glyph-words';
import { useStore } from '../state';
import { useMissingCharacters } from './use-missing-characters';

export function FontUsageHint(props: {
  readonly fontKey: string;
  readonly embeddedFonts: ReadonlyArray<EmbeddedFont>;
  readonly content: string;
  readonly variable: boolean;
  readonly fontAvailable: boolean;
}): JSX.Element | null {
  const csv = useStore((state) => state.project.variables?.csv);
  const singleLine = findFontEntry(props.fontKey)?.geometry === 'single-line';
  const { missing, unchecked } = useMissingCharacters({
    fontKey: props.fontKey,
    embeddedFonts: props.embeddedFonts,
    content: props.content,
    variable: props.variable,
    csv,
    enabled: props.fontAvailable,
  });
  if (!singleLine && missing.length === 0 && unchecked === null) return null;
  return (
    <small style={hintStyle}>
      {singleLine && (
        <>
          CNC single-line font: use Engrave or Profile on path. Pocket, Fill, and V-carve require
          closed outline text.
          <span style={detailStyle}>
            Character coverage varies by face; unsupported characters become ?.
          </span>
        </>
      )}
      {missing.length > 0 && (
        <span role="status" style={warningStyle}>
          {missingCharactersSentence(
            'This font',
            missing,
            props.fontKey,
            props.variable ? ' (in this text or the CSV values it uses)' : '',
          )}
        </span>
      )}
      {unchecked !== null && (
        <span role="status" style={warningStyle}>
          Could not check this font for missing characters. {unchecked}
        </span>
      )}
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

const warningStyle: React.CSSProperties = {
  display: 'block',
  color: 'var(--lf-warning-fg)',
};
