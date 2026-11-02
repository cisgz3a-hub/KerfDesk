import type { PreflightIssue } from '../../core/preflight';
import type { Project, TextObject, VariableTemplate } from '../../core/scene';
import { variableTemplateCsvRecord, type VariableEvaluationContext } from '../../core/variables';
import { findFontEntry } from '../../core/text/font-registry';
import {
  fontDisplayName,
  missingCharacterLabel,
  missingCharactersSentence,
} from '../../core/text/missing-glyph-words';
import type { PreparedOutput } from './prepare-output';

// ADR-591 Amendments 1 and 2. A character a text's font has no glyph for burns as the font's box
// or not at all, so output names it for every text it burns: each variable record, and plain text
// from any route (the text editor, Bake, a production row, the jig editor, a remote edit).

/**
 * What one text has to say about its burn. `message` is the sentence alone; the other fields let
 * several texts share one toast (ADR-591 Amendment 3).
 */
export type TextNotice = PreflightIssue & {
  /** "Text “Café 李”", which a count of copies can follow. */
  readonly lead: string;
  /** What follows the lead in `message`. */
  readonly rest: string;
  /** "“Café 李”" with its place, as a merged list names it. */
  readonly subject: string;
  /** The notice in the fewest words, as a merged list adds it after the subject. */
  readonly brief: string;
};

type NoticeFamily = {
  readonly codes: ReadonlyArray<PreflightIssue['code']>;
  readonly merged: (count: number, list: string) => string;
};

// One toast per family per output, so repeats and different texts alike cannot push out the
// output's other warnings.
const NOTICE_FAMILIES: ReadonlyArray<NoticeFamily> = [
  {
    codes: ['variable-text-missing-glyphs', 'text-missing-glyphs'],
    merged: (count, list) =>
      `Missing characters in ${count} texts: ${list}. Each engraves as the font’s box or ?, or not at all.`,
  },
  {
    codes: ['variable-text-overflow'],
    merged: (count, list) =>
      `${count} variable records overflow their frames and still burn in full: ${list}.`,
  },
  {
    codes: ['text-rtl-unsupported'],
    merged: (count, list) =>
      `Right-to-left isn’t supported on single-line fonts, so ${count} texts burn left to right: ${list}.`,
  },
];

const OUTPUT_NOTICE_CODES: ReadonlySet<PreflightIssue['code']> = new Set(
  NOTICE_FAMILIES.flatMap((family) => family.codes),
);
const MERGED_TEXTS_NAMED = 5;
const CHARACTERS_NAMED = 12;

/**
 * The advisories only the snapshot knows: what a burned text's font or frame does to it. Start and
 * Save re-run the project's preflight when they emit, which checks neither, so they add these to
 * their warnings.
 */
export function textOutputWarnings(prepared: PreparedOutput): ReadonlyArray<string> {
  if (!prepared.ok) return [];
  return (prepared.advisories ?? []).flatMap((issue) =>
    OUTPUT_NOTICE_CODES.has(issue.code) ? [issue.message] : [],
  );
}

/** Every text's notices as one issue per family, whichever texts and however many copies. */
export function mergeTextNotices(
  notices: ReadonlyArray<TextNotice>,
): ReadonlyArray<PreflightIssue> {
  return NOTICE_FAMILIES.flatMap((family) => {
    const members = notices.filter((notice) => family.codes.includes(notice.code));
    const first = members[0];
    if (first === undefined) return [];
    const copies = new Map<string, { readonly notice: TextNotice; count: number }>();
    for (const notice of members) {
      const seen = copies.get(notice.message);
      if (seen === undefined) copies.set(notice.message, { notice, count: 1 });
      else seen.count += 1;
    }
    const distinct = [...copies.values()];
    return [{ code: first.code, message: mergedMessage(family, distinct, members.length) }];
  });
}

function mergedMessage(
  family: NoticeFamily,
  distinct: ReadonlyArray<{ readonly notice: TextNotice; readonly count: number }>,
  total: number,
): string {
  const only = distinct[0];
  if (distinct.length === 1 && only !== undefined)
    return only.count === 1
      ? only.notice.message
      : `${only.notice.lead} (${only.count} copies)${only.notice.rest}`;
  const named = distinct
    .slice(0, MERGED_TEXTS_NAMED)
    .map(
      ({ notice, count }) => `${notice.subject}${count === 1 ? '' : ` ×${count}`} ${notice.brief}`,
    );
  const unnamed = distinct.length - named.length;
  const list = named.join(', ') + (unnamed === 0 ? '' : `, and ${unnamed} more`);
  return family.merged(total, list);
}

function notice(
  code: PreflightIssue['code'],
  lead: string,
  rest: string,
  subject: string,
  brief: string,
): TextNotice {
  return { code, message: `${lead}${rest}`, lead, rest, subject, brief };
}

function csvPlace(csvRecord: number | null): string {
  return csvRecord === null ? '' : ` (CSV record ${csvRecord})`;
}

// Names the characters up to a cap: one text can lack a whole script.
function glyphSentence(
  text: TextObject,
  missing: ReadonlyArray<string>,
  project: Project,
): { readonly sentence: string; readonly brief: string } {
  const named = missing.slice(0, CHARACTERS_NAMED);
  const more = missing.length - named.length;
  const font = fontName(text, project);
  const beyond = more === 0 ? '' : ` and ${more} more`;
  return {
    sentence: missingCharactersSentence(font, named, text.fontKey, beyond),
    brief: `(${font}: ${named.map(missingCharacterLabel).join(' ')}${beyond})`,
  };
}

/** "Variable text “Zoë 李” (CSV record 3): Pacifico has no 李; each engraves as …" */
export function variableRecordGlyphAdvisory(
  text: TextObject,
  template: VariableTemplate,
  record: { readonly value: string; readonly missing: ReadonlyArray<string> },
  project: Project,
  context: VariableEvaluationContext,
): TextNotice | undefined {
  if (record.missing.length === 0) return undefined;
  const place = csvPlace(variableTemplateCsvRecord(template, project, context));
  const { sentence, brief } = glyphSentence(text, record.missing, project);
  const quoted = `“${excerpt(record.value)}”${place}`;
  return notice(
    'variable-text-missing-glyphs',
    `Variable text ${quoted}`,
    `: ${sentence}`,
    quoted,
    brief,
  );
}

/** "Variable text “Maximilian” (CSV record 3): overflows its frame by 33.3 mm. It still burns in full." */
export function variableRecordOverflowAdvisory(
  template: VariableTemplate,
  record: { readonly value: string; readonly overflowMm: number | undefined },
  project: Project,
  context: VariableEvaluationContext,
): TextNotice | undefined {
  if (record.overflowMm === undefined) return undefined;
  const place = csvPlace(variableTemplateCsvRecord(template, project, context));
  const quoted = `“${excerpt(record.value)}”${place}`;
  const mm = Math.max(0.1, Math.round(record.overflowMm * 10) / 10).toFixed(1);
  return notice(
    'variable-text-overflow',
    `Variable text ${quoted}`,
    `: overflows its frame by ${mm} mm. It still burns in full.`,
    quoted,
    `by ${mm} mm`,
  );
}

/** Whether a text asks for what its font cannot do: single-line fonts have no bidi layout. */
export function asksRightToLeftOnSingleLine(text: TextObject): boolean {
  return (
    text.textStyle?.forceRtl === true && findFontEntry(text.fontKey)?.geometry === 'single-line'
  );
}

/**
 * "Text “Straße”: Right-to-left isn’t supported on Relief SingleLine, so it burns left to right."
 * Text an older build drew keeps the ? it drew for the bidi marks until it is next edited.
 */
export function rightToLeftAdvisory(
  text: TextObject,
  content: string,
  project: Project,
  storedQuestionMarks = false,
  where?: string,
): TextNotice {
  const quoted = `“${excerpt(content)}”${where === undefined ? '' : ` (${where})`}`;
  const font = fontName(text, project);
  const older = storedQuestionMarks
    ? ' Saved by an older build, it also burns a ? at each end of every line until you edit it.'
    : '';
  return notice(
    'text-rtl-unsupported',
    `Text ${quoted}`,
    `: Right-to-left isn’t supported on ${font}, so it burns left to right.${older}`,
    quoted,
    storedQuestionMarks ? `(${font}; has ? at each line end until edited)` : `(${font})`,
  );
}

/** "Text “Café 李” (production row 2): Pacifico has no 李; each engraves as …" */
export function plainTextGlyphAdvisory(
  text: TextObject,
  missing: ReadonlyArray<string>,
  project: Project,
  where?: string,
): TextNotice | undefined {
  if (missing.length === 0) return undefined;
  const quoted = `“${excerpt(text.content)}”${where === undefined ? '' : ` (${where})`}`;
  const { sentence, brief } = glyphSentence(text, missing, project);
  return notice('text-missing-glyphs', `Text ${quoted}`, `: ${sentence}`, quoted, brief);
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
