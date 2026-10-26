import type { EmbeddedFont, Project, SceneObject } from '../../core/scene';

/** A text guide in the copied dependency closure needs its font as well. */
export function copiedEmbeddedFonts(
  project: Project,
  objects: ReadonlyArray<SceneObject>,
): ReadonlyArray<EmbeddedFont> {
  const keys = textFontKeys(objects);
  const fonts = new Map<string, EmbeddedFont>();
  for (const font of project.embeddedFonts ?? []) {
    if (keys.has(font.key) && !fonts.has(font.key)) fonts.set(font.key, { ...font });
  }
  return [...fonts.values()];
}

/** Preserve each document's font bytes when two imported keys happen to collide. */
export function mergeClipboardFonts(
  project: Project,
  objects: ReadonlyArray<SceneObject>,
  copiedFonts: ReadonlyArray<EmbeddedFont>,
): {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly embeddedFonts: Project['embeddedFonts'];
} {
  const fonts = [...(project.embeddedFonts ?? [])];
  const sourceKeys = textFontKeys(objects);
  const targetKeys = textFontKeys(project.scene.objects);
  const reserved = new Set([
    ...fonts.map((font) => font.key),
    ...copiedFonts.map((font) => font.key),
    ...sourceKeys,
    ...targetKeys,
  ]);
  const remap = new Map<string, string>();
  for (const key of sourceKeys) {
    const source = copiedFonts.find((font) => font.key === key);
    const existing = fonts.find((font) => font.key === key);
    if (source === undefined) {
      // Missing source data must not silently adopt another document's font.
      if (key.startsWith('embedded:') && existing !== undefined)
        remap.set(key, freshFontKey(reserved));
      continue;
    }
    const sameBytes = fonts.find((font) => font.dataBase64 === source.dataBase64);
    if (sameBytes !== undefined) {
      remap.set(key, sameBytes.key);
      continue;
    }
    const targetKey = existing === undefined && !targetKeys.has(key) ? key : freshFontKey(reserved);
    remap.set(key, targetKey);
    fonts.push({ ...source, key: targetKey });
  }
  return {
    objects: objects.map((object) => {
      if (object.kind !== 'text') return object;
      const key = remap.get(object.fontKey);
      return key === undefined || key === object.fontKey ? object : { ...object, fontKey: key };
    }),
    embeddedFonts:
      fonts.length === (project.embeddedFonts?.length ?? 0) ? project.embeddedFonts : fonts,
  };
}

function textFontKeys(objects: ReadonlyArray<SceneObject>): ReadonlySet<string> {
  return new Set(objects.flatMap((object) => (object.kind === 'text' ? [object.fontKey] : [])));
}

function freshFontKey(reserved: Set<string>): string {
  let key = `embedded:${crypto.randomUUID()}`;
  while (reserved.has(key)) key = `embedded:${crypto.randomUUID()}`;
  reserved.add(key);
  return key;
}
