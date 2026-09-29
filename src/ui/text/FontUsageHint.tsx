import type { EmbeddedFont } from '../../core/scene';
import { findFontEntry } from '../../core/text';
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
  const missing = useMissingCharacters({
    fontKey: props.fontKey,
    embeddedFonts: props.embeddedFonts,
    content: props.content,
    variable: props.variable,
    csv,
    enabled: props.fontAvailable,
  });
  if (!singleLine && missing.length === 0) return null;
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
          {missingCharactersMessage(missing, singleLine, props.variable)}
        </span>
      )}
    </small>
  );
}

function missingCharactersMessage(
  missing: ReadonlyArray<string>,
  singleLine: boolean,
  variable: boolean,
): string {
  const where = variable ? ' (in this text or the CSV values it uses)' : '';
  const outcome = singleLine ? 'each engraves as ?' : 'each engraves as a box, or not at all';
  return `This font has no ${missing.map(characterLabel).join(' ')}${where}; ${outcome}.`;
}

// Spaces, controls and combining marks would be invisible in the list.
function characterLabel(character: string): string {
  if (/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(character)) return character;
  const code = character.codePointAt(0) ?? 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
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
