// The project's embedded fonts as one set (ADR-628 Amendment 1, audit 13-P2-2).
//
// Each font Import or System fonts choice used to embed a fresh copy under a
// new key, and nothing removed a font no text used any more, so the 33rd try
// left a project that Save and autosave refuse. A choice now reuses an
// embedded font with the same bytes, the limit is applied when the font is
// chosen, and a font nothing in the project names is dropped when text is
// committed and when the project is saved.

import type { EmbeddedFont, Project } from '../scene';

export const MAX_EMBEDDED_FONTS = 32;
// Every embedded key has this prefix (project-embedded-font-validator.ts).
const EMBEDDED_KEY_PREFIX = 'embedded:';

export type EmbeddedFontChoice =
  | { readonly kind: 'existing'; readonly key: string }
  | { readonly kind: 'new'; readonly font: EmbeddedFont }
  | { readonly kind: 'full'; readonly reason: string };

export const EMBEDDED_FONT_LIMIT_REASON = `This project already uses ${MAX_EMBEDDED_FONTS} embedded fonts, the most it can hold. Choose one of them, or change or delete text that uses a font you no longer need.`;

/**
 * What choosing `font` for a text does to the project. `replacingObjectId` is
 * the text being edited: the font it uses now is freed if nothing else uses it.
 */
export function embeddedFontChoice(
  project: Project,
  font: EmbeddedFont,
  replacingObjectId?: string,
): EmbeddedFontChoice {
  const same = (project.embeddedFonts ?? []).find(
    (candidate) => candidate.dataBase64 === font.dataBase64,
  );
  if (same !== undefined) return { kind: 'existing', key: same.key };
  const others =
    replacingObjectId === undefined
      ? project
      : {
          ...project,
          scene: {
            ...project.scene,
            objects: project.scene.objects.filter((object) => object.id !== replacingObjectId),
          },
        };
  return (withReferencedEmbeddedFonts(others).embeddedFonts ?? []).length >= MAX_EMBEDDED_FONTS
    ? { kind: 'full', reason: EMBEDDED_FONT_LIMIT_REASON }
    : { kind: 'new', font };
}

/** The project with every embedded font that nothing in it names removed.
 *  Unchanged (the same object) when every font is still used. */
export function withReferencedEmbeddedFonts(project: Project): Project {
  const fonts = project.embeddedFonts;
  if (fonts === undefined || fonts.length === 0) return project;
  const used = referencedFontKeys(project, new Set(fonts.map((font) => font.key)));
  if (used.size === fonts.length) return project;
  return { ...project, embeddedFonts: fonts.filter((font) => used.has(font.key)) };
}

// A font is in use when any value anywhere in the project, other than its own
// entry, is its key: a text's fontKey on the canvas, in a sheet, a retained
// array, a Boolean archive or anything added later. Matching every container
// by name could miss one and lose a font a text still needs.
function referencedFontKeys(project: Project, keys: ReadonlySet<string>): ReadonlySet<string> {
  const used = new Set<string>();
  const pending: unknown[] = [];
  for (const [field, value] of Object.entries(project)) {
    if (field !== 'embeddedFonts') pending.push(value);
  }
  while (pending.length > 0 && used.size < keys.size) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (value.startsWith(EMBEDDED_KEY_PREFIX) && keys.has(value)) used.add(value);
    } else {
      for (const child of childValues(value)) pending.push(child);
    }
  }
  return used;
}

function childValues(value: unknown): ReadonlyArray<unknown> {
  // Coordinate and pixel arrays cannot name a font.
  if (Array.isArray(value)) return typeof value[0] === 'number' ? [] : value;
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return [];
  return Object.values(value);
}
