import type { EmbeddedFont } from '../../core/scene';
import {
  fontDisplayName,
  missingCharacterOutcome,
  missingCharactersSentence,
} from '../../core/text/missing-glyph-words';
import { useToastStore } from '../state/toast-store';

/**
 * ADR-591 Amendment 1. Remote text whose font has no glyph for some of its characters is made as
 * the desktop makes it, with the font's box or nothing in their place, and the PC editor's warning
 * comes back in the receipt's `notices` (the contract of ADR-125 Amendment 2) and shows on the PC.
 */
export type RemoteTextNotice = { readonly level: 'warning'; readonly message: string };

const MAX_NOTICE_LENGTH = 2048;

export type MissingGlyphReport = {
  readonly fontKey: string;
  readonly missing: readonly string[];
  readonly embeddedFonts: ReadonlyArray<EmbeddedFont> | undefined;
  /**
   * The client sent the wording, so naming its characters tells it nothing new. An edit of
   * PC-made text that sent no wording says how many, as the text itself needs artwork sharing.
   */
  readonly clientWording: boolean;
};

/** Receipt fields: `notices` when the font lacks a character, none otherwise. */
export function missingGlyphNoticeFields(
  report: MissingGlyphReport,
): { readonly notices: readonly RemoteTextNotice[] } | Record<string, never> {
  if (report.missing.length === 0) return {};
  const font = fontDisplayName(report.fontKey, report.embeddedFonts);
  const message = report.clientWording
    ? missingCharactersSentence(font, report.missing, report.fontKey)
    : `${font} has no glyph for ${countWords(report.missing.length)} of this text; ` +
      `${missingCharacterOutcome(report.fontKey)}. Check it on the PC.`;
  return { notices: [{ level: 'warning', message: message.slice(0, MAX_NOTICE_LENGTH) }] };
}

/** The PC's own copy, once the edit has committed. It always names the characters. */
export function showMissingGlyphsOnPc(report: MissingGlyphReport): void {
  if (report.missing.length === 0) return;
  const font = fontDisplayName(report.fontKey, report.embeddedFonts);
  useToastStore
    .getState()
    .pushToast(
      `Remote text: ${missingCharactersSentence(font, report.missing, report.fontKey)}`,
      'warning',
    );
}

function countWords(count: number): string {
  return count === 1 ? 'one character' : `${count} characters`;
}
