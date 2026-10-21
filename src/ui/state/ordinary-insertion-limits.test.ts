import { beforeEach, expect, it } from 'vitest';
import { createLayer, type TextObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { readAutosave, writeAutosave } from './autosave';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';
import { projectWithVariants } from './testing/scene-clipboard-fixtures';
import { expectUnchanged, lastToast, loadScene, rects } from './testing/scene-limit-fixtures';
import { useToastStore } from './toast-store';
import { undoStepName, withUndoStepName } from './undo-step-names';

const shape = (id = 'new-shape') =>
  createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  });
const text = (): TextObject => {
  const object = projectWithVariants().scene.objects.find((object) => object.kind === 'text');
  if (object?.kind !== 'text') throw new Error('Missing text fixture');
  return { ...object, fontKey: 'roboto-regular' };
};
function loadOperations(count: number) {
  return loadScene(
    [],
    [],
    [],
    Array.from({ length: count }, (_, index) =>
      createLayer({
        id: `operation-${index}`,
        color: `#${index.toString(16).padStart(6, '0')}`,
      }),
    ),
  );
}

beforeEach(() => {
  resetStore();
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
});

it('keeps the 257th drawing atomic and leaves the current project saveable and recoverable', () => {
  for (let index = 0; index < 256; index++) useStore.getState().drawShape(shape(`shape-${index}`));
  const before = useStore.getState();
  const saved = writeAutosave(before.project, 1);
  expect(saved.kind).toBe('ok');
  withUndoStepName('Refused rectangle', () => useStore.getState().drawShape(shape()));
  const after = useStore.getState();
  expect(after.project).toBe(before.project);
  expect(after.selectedObjectId).toBe(before.selectedObjectId);
  expect(after.undoStack).toBe(before.undoStack);
  expect(after.redoStack).toBe(before.redoStack);
  expect(undoStepName(before.project, before.project)).not.toBe('Refused rectangle');
  expect(lastToast()?.message).toContain('256 operations');
  expect(prepareProjectForPersistence(after.project).kind).toBe('ok');
  expect(writeAutosave(after.project, 2).kind).toBe('ok');
  expect(readAutosave()?.project.scene.objects).toHaveLength(256);
});

it.each([
  ['shape', () => useStore.getState().drawShape(shape()), false],
  ['text', () => useStore.getState().upsertTextObject(text()), true],
  [
    'vector import',
    () => useStore.getState().importSvgObject(svgObj('new-vector', ['#000000'])),
    true,
  ],
  [
    'raster import',
    () => {
      const raster = projectWithVariants().scene.objects.find(
        (object) => object.kind === 'raster-image',
      );
      if (raster === undefined) throw new Error('Missing raster fixture');
      useStore.getState().importRasterImage(raster);
    },
    true,
  ],
] as const)('%s enforces the operation limit at its store entry', (_name, insert, throws) => {
  const before = loadOperations(256);
  if (throws) expect(insert).toThrow('256 operations');
  else insert();
  expectUnchanged(before);
  loadOperations(255);
  insert();
  expect(useStore.getState().project.scene.layers).toHaveLength(256);
});

it('enforces the object limit even when there is room for another operation', () => {
  const before = loadScene(rects(10_000), ['filler-0']);
  useStore.getState().drawShape(shape());
  expectUnchanged(before);
  expect(useStore.getState().selectedObjectId).toBe('filler-0');
  expect(lastToast()?.message).toContain('10000 objects');
});

it('keeps editing existing text available at the operation limit', () => {
  const before = loadOperations(256);
  const original = { ...text(), operationIds: ['operation-0'] };
  useStore.setState({ project: { ...before, scene: { ...before.scene, objects: [original] } } });
  useStore.getState().upsertTextObject({ ...original, content: 'Edited' });
  expect(useStore.getState().project.scene.objects[0]).toMatchObject({ content: 'Edited' });
  expect(useStore.getState().project.scene.layers).toHaveLength(256);
  expect(lastToast()).toBeUndefined();
});

it('does not add a 33rd imported font when creating text', () => {
  const embeddedFonts = Array.from({ length: 32 }, (_, index) => ({
    key: `embedded:${index}`,
    fileName: `${index}.ttf`,
    dataBase64: 'AAEAAA==',
  }));
  const project = { ...useStore.getState().project, embeddedFonts };
  useStore.setState({ project });
  expect(() =>
    useStore.getState().upsertTextObject(
      { ...text(), fontKey: 'embedded:new' },
      {
        key: 'embedded:new',
        fileName: 'new.ttf',
        dataBase64: 'AAEAAA==',
      },
    ),
  ).toThrow('32 imported fonts');
  expectUnchanged(project);
});
