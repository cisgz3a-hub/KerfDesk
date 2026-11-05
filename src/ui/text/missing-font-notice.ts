// A project whose text uses a font this computer doesn't have still burns the
// saved outline, but editing that text is blocked until a font is chosen. The
// open said only "Success: Opened …", and the reason sat below the text
// panel's visible edge naming a "Relink" control that doesn't exist (UX audit
// U5-P3-9). These words name the panel's real controls.

import { FONT_REGISTRY } from '../../core/text';
import type { Project } from '../../core/scene';

/** A font key as the beginner knows it: "system:Bauhaus 93" → "Bauhaus 93". */
export function fontDisplayName(key: string): string {
  return key.replace(/^system:/, '');
}

export const CHOOSE_FONT_TO_EDIT =
  'Choose a font with Import or System fonts... to edit this text.';

export function missingFontReason(key: string): string {
  return `The font ${fontDisplayName(key)} isn't on this computer. ${CHOOSE_FONT_TO_EDIT}`;
}

/** The fonts the project's text uses that neither KerfDesk nor the project carries. */
export function missingProjectFonts(project: Project): ReadonlyArray<string> {
  const known = new Set<string>(FONT_REGISTRY.map((font) => font.key));
  for (const font of project.embeddedFonts ?? []) known.add(font.key);
  const missing = new Set<string>();
  for (const object of project.scene.objects) {
    if (object.kind === 'text' && !known.has(object.fontKey)) missing.add(object.fontKey);
  }
  return [...missing];
}

/** The warning shown after the open's own toast, or null when every font is here. */
export function missingFontOpenNotice(project: Project): string | null {
  const missing = missingProjectFonts(project).map(fontDisplayName);
  if (missing.length === 0) return null;
  const names = missing.join(', ');
  const subject =
    missing.length === 1
      ? `a font that isn't on this computer (${names})`
      : `fonts that aren't on this computer (${names})`;
  return `This project uses ${subject}. Its text will burn as saved; to edit that text, choose Import or System fonts... in the text panel.`;
}
