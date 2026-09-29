import { useEffect, useMemo, useState } from 'react';
import type { EmbeddedFont, VariableCsvDataset } from '../../core/scene';
import { DEFAULT_TEXT_COLOR, findFontEntry } from '../../core/text';
import { cncStrokeTextToPolylines } from '../../core/text/cnc-stroke-font';
import { outlineFontMissingCharacters } from '../../core/text/text-to-polylines';
import { parseVariableTemplateSource } from '../../core/variables';
import { loadFont } from './font-loader';

// Checking an outline font parses it, so the check waits for typing to settle.
const CHECK_DELAY_MS = 300;
const COLUMN_SEPARATOR = '\u0000';

export type MissingCharacterQuery = {
  readonly fontKey: string;
  readonly embeddedFonts: ReadonlyArray<EmbeddedFont>;
  readonly content: string;
  // Variable text engraves its literal text plus the CSV values it names.
  readonly variable: boolean;
  readonly csv: VariableCsvDataset | undefined;
  readonly enabled: boolean;
};

type FontCheck = { readonly fontKey: string; readonly missing: ReadonlyArray<string> };

/** The characters this text will engrave that the chosen font has no glyph for. */
export function useMissingCharacters(query: MissingCharacterQuery): ReadonlyArray<string> {
  const { fontKey, embeddedFonts, content, variable, csv, enabled } = query;
  const engraved = useMemo(() => engravedSource(content, variable), [content, variable]);
  const csvCharacters = useMemo(
    () => csvColumnCharacters(csv, engraved.columns),
    [csv, engraved.columns],
  );
  const characters = distinctCharacters(`${engraved.literal}${csvCharacters}`);
  const [checked, setChecked] = useState<FontCheck | null>(null);
  useEffect(() => {
    if (!enabled || characters === '') return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      void fontMissingCharacters(fontKey, embeddedFonts, characters)
        // A font that cannot load is reported by the dialog's own font check.
        .catch((): ReadonlyArray<string> => [])
        .then((missing) => {
          if (active) setChecked({ fontKey, missing });
        });
    }, CHECK_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [enabled, fontKey, embeddedFonts, characters]);
  if (!enabled || checked?.fontKey !== fontKey) return [];
  // A character deleted since the last check leaves the warning at once.
  return checked.missing.filter((character) => characters.includes(character));
}

async function fontMissingCharacters(
  fontKey: string,
  embeddedFonts: ReadonlyArray<EmbeddedFont>,
  characters: string,
): Promise<ReadonlyArray<string>> {
  if (findFontEntry(fontKey)?.geometry !== 'single-line') {
    return outlineFontMissingCharacters(await loadFont(fontKey, embeddedFonts), characters);
  }
  const rendered = await cncStrokeTextToPolylines({
    fontKey,
    content: characters,
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    color: DEFAULT_TEXT_COLOR,
  });
  return rendered.missingCharacters ?? [];
}

// Serial, date and cut-setting fields are left to output: their characters
// are digits and the format's own text.
function engravedSource(
  content: string,
  variable: boolean,
): { readonly literal: string; readonly columns: string } {
  const parsed = variable ? parseVariableTemplateSource(content) : null;
  if (parsed === null || !parsed.ok) return { literal: content, columns: '' };
  const tokens = parsed.template.tokens;
  return {
    literal: tokens.map((token) => (token.kind === 'literal' ? token.value : '')).join(''),
    columns: tokens
      .flatMap((token) => (token.kind === 'csv' ? [token.column] : []))
      .join(COLUMN_SEPARATOR),
  };
}

function csvColumnCharacters(csv: VariableCsvDataset | undefined, columns: string): string {
  if (csv === undefined || columns === '') return '';
  const indexes = columns
    .split(COLUMN_SEPARATOR)
    .map((column) => csv.headers.indexOf(column))
    .filter((index) => index >= 0);
  const seen = new Set<string>();
  for (const record of csv.records) {
    for (const index of indexes) for (const character of record[index] ?? '') seen.add(character);
  }
  return [...seen].join('');
}

function distinctCharacters(text: string): string {
  return [...new Set(text)].join('');
}
