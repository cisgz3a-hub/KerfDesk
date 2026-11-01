import type { PreflightIssue } from '../../core/preflight';
import type { Project, TextObject, VariableTemplate } from '../../core/scene';
import { variableTemplateCsvRecord, type VariableEvaluationContext } from '../../core/variables';
import { fontDisplayName, missingCharactersSentence } from '../../core/text/missing-glyph-words';
import type { PreparedOutput } from './prepare-output';

// ADR-591 Amendments 1 and 2. A character a text's font has no glyph for burns as the font's box
// or not at all, so output names it for every text it burns: each variable record, and plain text
// from any route (the text editor, Bake, a production row, the jig editor, a remote edit).

const GLYPH_CODES: ReadonlySet<PreflightIssue['code']> = new Set([
  'variable-text-missing-glyphs',
  'text-missing-glyphs',
]);

/**
 * The advisories only the snapshot knows: the characters a burned text's font lacks. Start and
 * Save re-run the project's preflight when they emit, which checks no glyphs, so they add these to
 * their warnings.
 */
export function textGlyphAdvisories(prepared: PreparedOutput): ReadonlyArray<string> {
  if (!prepared.ok) return [];
  return (prepared.advisories ?? []).flatMap((issue) =>
    GLYPH_CODES.has(issue.code) ? [issue.message] : [],
  );
}

/** "Variable text “Zoë 李” (CSV record 3): Pacifico has no 李; each engraves as …" */
export function variableRecordGlyphAdvisory(
  text: TextObject,
  template: VariableTemplate,
  record: { readonly value: string; readonly missing: ReadonlyArray<string> },
  project: Project,
  context: VariableEvaluationContext,
): PreflightIssue | undefined {
  if (record.missing.length === 0) return undefined;
  const csvRecord = variableTemplateCsvRecord(template, project, context);
  return {
    code: 'variable-text-missing-glyphs',
    message:
      `Variable text “${excerpt(record.value)}”` +
      `${csvRecord === null ? '' : ` (CSV record ${csvRecord})`}: ` +
      missingCharactersSentence(fontName(text, project), record.missing, text.fontKey),
  };
}

/** "Text “Café 李” (production row 2): Pacifico has no 李; each engraves as …" */
export function plainTextGlyphAdvisory(
  text: TextObject,
  missing: ReadonlyArray<string>,
  project: Project,
  where?: string,
): PreflightIssue | undefined {
  if (missing.length === 0) return undefined;
  return {
    code: 'text-missing-glyphs',
    message:
      `Text “${excerpt(text.content)}”${where === undefined ? '' : ` (${where})`}: ` +
      missingCharactersSentence(fontName(text, project), missing, text.fontKey),
  };
}

const EXCERPT_LENGTH = 40;

function excerpt(value: string): string {
  const characters = [...value.replace(/\s+/g, ' ').trim()];
  return characters.length > EXCERPT_LENGTH
    ? `${characters.slice(0, EXCERPT_LENGTH - 1).join('')}…`
    : characters.join('');
}

function fontName(text: TextObject, project: Project): string {
  return fontDisplayName(text.fontKey, project.embeddedFonts);
}
