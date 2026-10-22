// Audit 13-P2-2 (regression). Every font Import or System fonts choice embedded
// a new copy that nothing reused or removed, so the 33rd try left a project
// that Save and autosave refused (ADR-628 Amendment 1).

import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type EmbeddedFont, type TextObject } from '../../core/scene';
import { prepareProjectForAutosave, prepareProjectForPersistence } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

function text(id: string, fontKey: string): TextObject {
  return {
    kind: 'text',
    id,
    content: 'Sign',
    fontKey,
    sizeMm: 12,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 5 },
            ],
          },
        ],
      },
    ],
  };
}

/** A font as one Import makes it: a fresh key, and the face's bytes. */
function font(key: string, face: number): EmbeddedFont {
  return {
    key: `embedded:${key}`,
    fileName: `Face${face}.otf`,
    dataBase64: btoa(`OTTO\0\x01\x02${String.fromCharCode(face)}`),
  };
}

function fontKeys(): ReadonlyArray<string> {
  return (useStore.getState().project.embeddedFonts ?? []).map((entry) => entry.key);
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('embedded fonts stay within the project limit', () => {
  it('reuses the embedded copy when the same face is chosen 33 times', () => {
    for (let attempt = 1; attempt <= 33; attempt += 1) {
      const choice = font(`try-${attempt}`, 7);
      useStore.getState().upsertTextObject(text('sign', choice.key), choice);
    }

    expect(fontKeys()).toEqual(['embedded:try-1']);
    const sign = useStore.getState().project.scene.objects[0];
    expect(sign?.kind === 'text' ? sign.fontKey : null).toBe('embedded:try-1');
    expect(prepareProjectForPersistence(useStore.getState().project).kind).toBe('ok');
  });

  it('keeps only the face in use when one text tries 33 faces, and undo brings the last back', () => {
    for (let face = 1; face <= 33; face += 1) {
      const choice = font(`face-${face}`, face);
      useStore.getState().upsertTextObject(text('sign', choice.key), choice);
    }

    expect(fontKeys()).toEqual(['embedded:face-33']);
    expect(prepareProjectForPersistence(useStore.getState().project).kind).toBe('ok');
    expect(prepareProjectForAutosave(useStore.getState().project).kind).toBe('ok');

    useStore.getState().undo();
    expect(fontKeys()).toEqual(['embedded:face-32']);
  });

  it('does not save a font whose text was deleted', () => {
    const choice = font('logo', 3);
    useStore.getState().upsertTextObject(text('sign', choice.key), choice);
    useStore.getState().removeSceneObject('sign');

    expect(fontKeys()).toEqual(['embedded:logo']);
    const saved = prepareProjectForPersistence(useStore.getState().project);
    expect(saved.kind).toBe('ok');
    if (saved.kind === 'ok') expect(saved.project.embeddedFonts).toEqual([]);
  });

  it('refuses a 33rd face that texts still use, and leaves the project as it was', () => {
    for (let face = 1; face <= 32; face += 1) {
      const choice = font(`face-${face}`, face);
      useStore.getState().upsertTextObject(text(`sign-${face}`, choice.key), choice);
    }
    const before = useStore.getState().project;

    const extra = font('face-33', 33);
    expect(() => useStore.getState().upsertTextObject(text('sign-33', extra.key), extra)).toThrow(
      '32 imported fonts',
    );

    expect(useStore.getState().project).toBe(before);
    expect(fontKeys()).toHaveLength(32);
    expect(prepareProjectForPersistence(before).kind).toBe('ok');
  });
});
