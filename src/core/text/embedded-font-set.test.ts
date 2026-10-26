// Audit 13-P2-2: the font a choice uses, and the fonts a project still names
// (ADR-628 Amendment 1).

import { describe, expect, it } from 'vitest';
import { createProject, type EmbeddedFont, type Project } from '../scene';
import {
  embeddedFontChoice,
  MAX_EMBEDDED_FONTS,
  withReferencedEmbeddedFonts,
} from './embedded-font-set';
import { encodeEmbeddedFont } from './embedded-font';

function font(key: string, face: number): EmbeddedFont {
  return encodeEmbeddedFont({
    key: `embedded:${key}`,
    fileName: `Face${face}.otf`,
    buffer: new Uint8Array([79, 84, 84, 79, 0, 1, 2, face]).buffer,
  });
}

function projectWith(fonts: ReadonlyArray<EmbeddedFont>, extra: Partial<Project> = {}): Project {
  return { ...createProject(), embeddedFonts: fonts, ...extra };
}

describe('withReferencedEmbeddedFonts', () => {
  it('keeps a font named anywhere in the project, not only by canvas text', () => {
    const used = font('in-sheet', 1);
    const unused = font('unused', 2);
    const project = projectWith([used, unused], {
      // Any container counts, however deep; a sheet stands in for all of them.
      sheetBook: { sheets: [{ snapshot: { scene: { objects: [{ fontKey: used.key }] } } }] },
    } as unknown as Partial<Project>);

    expect(withReferencedEmbeddedFonts(project).embeddedFonts).toEqual([used]);
  });

  it('returns the same project when every font is in use or there are none', () => {
    const none = createProject();
    expect(withReferencedEmbeddedFonts(none)).toBe(none);
    const used = font('used', 1);
    const project = projectWith([used], { notes: used.key });
    expect(withReferencedEmbeddedFonts(project)).toBe(project);
  });
});

describe('embeddedFontChoice', () => {
  it('reuses a font already embedded with the same bytes', () => {
    const existing = font('first', 4);
    expect(embeddedFontChoice(projectWith([existing]), font('again', 4))).toEqual({
      kind: 'existing',
      key: existing.key,
    });
  });

  it('refuses a new face once the fonts in use reach the limit, unless the edited text frees one', () => {
    const fonts = Array.from({ length: MAX_EMBEDDED_FONTS }, (_, index) =>
      font(`f${index}`, index),
    );
    const objects = fonts.map((entry, index) => ({
      id: `t${index}`,
      kind: 'text',
      fontKey: entry.key,
    }));
    const full = projectWith(fonts, {
      scene: { ...createProject().scene, objects },
    } as unknown as Partial<Project>);
    const candidate = font('new', 200);

    expect(embeddedFontChoice(full, candidate).kind).toBe('full');
    expect(embeddedFontChoice(full, candidate, 't0')).toEqual({ kind: 'new', font: candidate });
  });
});
