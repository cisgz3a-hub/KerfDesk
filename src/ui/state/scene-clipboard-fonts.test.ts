import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { createProject, type EmbeddedFont, type TextObject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { dependencyProject, projectWithVariants } from './testing/scene-clipboard-fixtures';
import { lastToast } from './testing/scene-limit-fixtures';
import { useToastStore } from './toast-store';

const fontBytes = readFileSync('src/ui/text/fonts/Roboto-Regular.ttf');
const font = (key = `embedded:${crypto.randomUUID()}`): EmbeddedFont => ({
  key,
  fileName: 'Imported.ttf',
  dataBase64: fontBytes.toString('base64'),
});
function text(key: string, id = 'source-text'): TextObject {
  const object = projectWithVariants().scene.objects.find((object) => object.kind === 'text');
  if (object?.kind !== 'text') throw new Error('Missing text fixture');
  return { ...object, id, fontKey: key };
}
function copy(fonts: readonly EmbeddedFont[], objects: readonly TextObject[]) {
  useStore.setState({ project: { ...dependencyProject(objects), embeddedFonts: fonts } });
  useStore.getState().selectObjects(objects.map((object) => object.id));
  useStore.getState().copySelection();
}
function reopen() {
  const result = deserializeProject(serializeProject(useStore.getState().project));
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('Reopen failed');
  return result.project;
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

it.each(['pasteClipboard', 'pasteClipboardInPlace'] as const)(
  '%s carries only referenced font bytes through New, Save, and a fresh font-loader session',
  async (paste) => {
    const sourceFont = font();
    const unusedFont = font();
    copy([sourceFont, unusedFont], [text(sourceFont.key), text(sourceFont.key, 'second-text')]);
    expect(useStore.getState().sceneClipboard?.embeddedFonts).toEqual([sourceFont]);
    // Before restart, the cache concealed the missing project font resource.
    const { loadFont } = await import('../text/font-loader');
    await loadFont(sourceFont.key, [sourceFont]);
    useStore.getState().newProject();
    useStore.getState()[paste]();
    const restored = reopen();
    expect(restored.embeddedFonts).toEqual([sourceFont]);
    expect(restored.scene.objects).toHaveLength(2);
    vi.resetModules();
    const fresh = await import('../text/font-loader');
    expect(Buffer.from(await fresh.loadFont(sourceFont.key, restored.embeddedFonts))).toEqual(
      fontBytes,
    );
  },
);

it('renames a colliding key and preserves both documents font bytes and text bindings', async () => {
  const sourceFont = font();
  const destinationFont = { ...sourceFont, dataBase64: 'AAEAAAE=' };
  copy([sourceFont], [text(sourceFont.key)]);
  useStore.getState().setProject({
    ...dependencyProject([text(sourceFont.key, 'destination-text')]),
    embeddedFonts: [destinationFont],
  });
  useStore.getState().pasteClipboard();
  const restored = reopen();
  const [original, pasted] = restored.scene.objects;
  expect(original).toMatchObject({ id: 'destination-text', fontKey: sourceFont.key });
  if (pasted?.kind !== 'text') throw new Error('Missing pasted text');
  expect(pasted.fontKey).not.toBe(sourceFont.key);
  expect(restored.embeddedFonts).toEqual([destinationFont, { ...sourceFont, key: pasted.fontKey }]);
  vi.resetModules();
  const { loadFont } = await import('../text/font-loader');
  expect(Buffer.from(await loadFont(pasted.fontKey, restored.embeddedFonts))).toEqual(fontBytes);
});

it('reuses identical font bytes without duplicating a key or consuming another font slot', () => {
  const sourceFont = font();
  copy([sourceFont], [text(sourceFont.key)]);
  useStore.getState().setProject({ ...createProject(), embeddedFonts: [sourceFont] });
  useStore.getState().pasteClipboard();
  useStore.getState().pasteClipboard();
  expect(reopen().embeddedFonts).toEqual([sourceFont]);
});

it('never binds missing source font bytes to a different font with the same destination key', () => {
  const destinationFont = font();
  copy([], [text(destinationFont.key)]);
  useStore.getState().setProject({ ...createProject(), embeddedFonts: [destinationFont] });
  useStore.getState().pasteClipboard();
  const pasted = useStore.getState().project.scene.objects[0];
  if (pasted?.kind !== 'text') throw new Error('Missing pasted text');
  expect(pasted.fontKey).not.toBe(destinationFont.key);
  expect(pasted.paths).toEqual(
    text(destinationFont.key).paths.map((path) => ({
      ...path,
      operationIds: pasted.paths[0]?.operationIds,
    })),
  );
  expect(useStore.getState().project.embeddedFonts).toEqual([destinationFont]);
});

it('does not change a destination text whose missing font key collides with copied bytes', () => {
  const sourceFont = font();
  copy([sourceFont], [text(sourceFont.key)]);
  useStore.getState().setProject(dependencyProject([text(sourceFont.key, 'missing-font-text')]));
  useStore.getState().pasteClipboard();
  const project = reopen();
  const pasted = project.scene.objects[1];
  if (pasted?.kind !== 'text') throw new Error('Missing pasted text');
  expect(pasted.fontKey).not.toBe(sourceFont.key);
  expect(project.embeddedFonts?.some((entry) => entry.key === sourceFont.key)).toBe(false);
});

it('refuses an over-budget paste without changing artwork, selection, history, or the clipboard', () => {
  const sourceFont = font();
  copy([sourceFont], [text(sourceFont.key)]);
  const fonts = Array.from({ length: 32 }, (_, index) => ({
    key: `embedded:destination-${index}`,
    fileName: `${index}.ttf`,
    dataBase64: Buffer.from([0, 1, 0, 0, index]).toString('base64'),
  }));
  useStore.getState().setProject({ ...createProject(), embeddedFonts: fonts });
  const before = useStore.getState();
  useStore.getState().pasteClipboard();
  const after = useStore.getState();
  expect(after.project).toBe(before.project);
  expect(after.selectedObjectId).toBe(before.selectedObjectId);
  expect(after.undoStack).toBe(before.undoStack);
  expect(after.redoStack).toBe(before.redoStack);
  expect(after.dirty).toBe(before.dirty);
  expect(after.sceneClipboard).toBe(before.sceneClipboard);
  expect(lastToast()?.message).toContain('32 imported fonts');
});
