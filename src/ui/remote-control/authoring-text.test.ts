import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { FONT_REGISTRY } from '../../core/text';
import { deserializeProject, serializeProject } from '../../io/project';
import type { TextObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import type { RemoteControlAdapter } from './types';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';

const fontLoad = vi.hoisted(() => vi.fn());
vi.mock('../text/font-loader', () => ({ loadFont: fontLoad }));
let adapter: RemoteControlAdapter;
let share = false;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  share = false;
  fontLoad.mockReset().mockImplementation(async (key: string) => {
    const { readFile } = await import('node:fs/promises');
    const file = key === 'tinos-regular' ? 'Tinos-Regular.ttf' : 'Roboto-Regular.ttf';
    return Uint8Array.from(await readFile(`src/ui/text/fonts/${file}`)).buffer;
  });
  adapter = testAdapter({ canShareArtwork: () => share });
});
afterEach(() => adapter.dispose());
async function text(fontId?: string): Promise<TextObject> {
  expect(
    resultCode(
      await adapter.execute(
        'add_text',
        writeArgs(adapter, {
          text: 'Original words',
          xMm: 15,
          yMm: -5,
          widthMm: 50,
          fontSizeMm: 8,
          ...(fontId === undefined ? {} : { fontId }),
        }),
      ),
    ),
  ).toBe('ok');
  return currentText();
}
function currentText(): TextObject {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'text') throw new Error('Expected fixture text.');
  return object;
}

describe('remote text authoring and sensitive source projection', () => {
  it('lists actual bundled fonts without private embedded names or font bytes', async () => {
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        embeddedFonts: [
          { key: 'private-font', fileName: 'C:/secret-font.ttf', dataBase64: 'PRIVATE_PAYLOAD' },
        ],
      },
    });
    const result = await adapter.execute('list_fonts', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data['total']).toBe(FONT_REGISTRY.length);
      expect(result.data['fonts']).toEqual(
        FONT_REGISTRY.map((entry) => ({
          id: entry.key,
          name: entry.displayName,
          geometry: entry.geometry,
          style: entry.styleClass,
        })),
      );
    }
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PAYLOAD|secret-font|private-font/);
  });

  it('requires explicit sharing for text reads and never leaks text in workspace summaries', async () => {
    const object = await text();
    expect(resultCode(await adapter.execute('get_text', { artworkId: object.id }))).toBe(
      'unavailable',
    );
    expect(JSON.stringify(await adapter.execute('get_workspace', {}))).not.toContain(
      'Original words',
    );
    share = true;
    expect(await adapter.execute('get_text', { artworkId: object.id })).toMatchObject({
      ok: true,
      data: { artworkId: object.id, text: 'Original words', fontId: object.fontKey, fontSizeMm: 8 },
    });
    const pending = adapter.execute('get_text', { artworkId: object.id });
    share = false;
    expect(resultCode(await pending)).toBe('unavailable');
  });

  it('keeps automatic text names private after conversion and an asynchronous opt-out', async () => {
    const original = await text();
    const project = useStore.getState().project;
    const label = project.scene.layers[0]!.name;
    expect(label).toContain('Original words');
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: [
            {
              ...createRectangle({
                id: original.id,
                color: original.color,
                spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
              }),
              ...(original.operationIds === undefined
                ? {}
                : { operationIds: original.operationIds }),
            },
          ],
        },
      },
    });
    const hidden = await adapter.execute('get_workspace', {});
    expect(hidden).toMatchObject({ ok: true, data: { operations: [{ name: 'Operation' }] } });
    expect(JSON.stringify(hidden)).not.toContain('Original words');
    share = true;
    const visible = await adapter.execute('get_workspace', {});
    expect(visible).toMatchObject({ ok: true, data: { operations: [{ name: label }] } });
    const pending = adapter.execute('get_workspace', {});
    share = false;
    expect(JSON.stringify(await pending)).not.toContain('Original words');
  });

  it('creates a selected bundled font while old add_text callers retain their default', async () => {
    expect((await text('tinos-regular')).fontKey).toBe('tinos-regular');
    expect(fontLoad).toHaveBeenCalledWith('tinos-regular', undefined);
    useStore.getState().newProject();
    expect((await text()).fontKey).toBe('roboto-regular');
    expect(fontLoad).toHaveBeenCalledWith('roboto-regular', undefined);
  });

  it('edits wording, font and spacing with actual geometry, preserving placement and operations', async () => {
    const original = await text();
    useStore.getState().setObjectTransform(original.id, {
      ...original.transform,
      rotationDeg: 37,
      mirrorX: true,
      scaleY: 0.7,
    });
    const before = currentText();
    const beforeHistory = useStore.getState().undoStack.length;
    const result = await adapter.execute(
      'update_text',
      writeArgs(adapter, {
        artworkId: before.id,
        patch: {
          text: 'New café words',
          fontId: 'tinos-regular',
          fontSizeMm: 12,
          alignment: 'center',
          lineHeight: 1.6,
          letterSpacing: 0.2,
        },
      }),
    );
    expect(resultCode(result)).toBe('ok');
    const next = currentText();
    expect(next).toMatchObject({
      id: before.id,
      content: 'New café words',
      fontKey: 'tinos-regular',
      sizeMm: 12,
      alignment: 'center',
      lineHeight: 1.6,
      letterSpacing: 0.2,
    });
    expect(next.transform).toEqual(before.transform);
    expect(next.operationIds).toEqual(before.operationIds);
    expect(next.paths).not.toEqual(before.paths);
    expect(useStore.getState().undoStack).toHaveLength(beforeHistory + 1);
    const decoded = deserializeProject(serializeProject(useStore.getState().project));
    expect(decoded.kind).toBe('ok');
    if (decoded.kind === 'ok')
      expect(decoded.project.scene.objects[0]).toMatchObject({
        content: 'New café words',
        transform: before.transform,
      });
    expect(resultCode(await adapter.execute('undo', writeArgs(adapter)))).toBe('ok');
    expect(currentText()).toEqual(before);
    expect(resultCode(await adapter.execute('redo', writeArgs(adapter)))).toBe('ok');
    expect(currentText()).toEqual(next);
  });

  it('does not silently clamp typography to local dialog limits or create history for identical values', async () => {
    const original = await text();
    expect(
      resultCode(
        await adapter.execute(
          'update_text',
          writeArgs(adapter, {
            artworkId: original.id,
            patch: { fontSizeMm: 0.5, lineHeight: 0.1, letterSpacing: -1 },
          }),
        ),
      ),
    ).toBe('ok');
    expect(currentText()).toMatchObject({ sizeMm: 0.5, lineHeight: 0.1, letterSpacing: -1 });
    const before = useStore.getState();
    expect(
      resultCode(
        await adapter.execute(
          'update_text',
          writeArgs(adapter, { artworkId: original.id, patch: { fontSizeMm: 0.5 } }),
        ),
      ),
    ).toBe('ok');
    expect(useStore.getState()).toBe(before);
  });

  it.each([
    {},
    { text: '' },
    { text: '   ' },
    { fontId: '../../private.ttf' },
    { fontId: 'not-a-font' },
    { fontSizeMm: 0 },
    { alignment: 'justify' },
    { lineHeight: 21 },
    { letterSpacing: -2 },
    { color: '#ff0000' },
    { text: 'x'.repeat(4097) },
  ])('refuses malformed or unsupported text changes atomically (%j)', async (patch) => {
    const original = await text();
    const before = useStore.getState();
    expect(
      resultCode(
        await adapter.execute('update_text', writeArgs(adapter, { artworkId: original.id, patch })),
      ),
    ).toBe('invalid_arguments');
    expect(useStore.getState()).toBe(before);
  });

  it.each(['path', 'variable', 'locked', 'hidden'] as const)(
    'refuses %s text instead of corrupting its authoring contract',
    async (kind) => {
      const original = await text();
      const project = useStore.getState().project;
      const modified = {
        ...original,
        ...(kind === 'path'
          ? { pathText: { guideObjectId: 'guide', offsetMm: 0, reverse: false } }
          : {}),
        ...(kind === 'variable' ? { variableTemplate: { tokens: [] } } : {}),
        ...(kind === 'locked' ? { locked: true } : {}),
      };
      useStore.setState({
        project: {
          ...project,
          scene: {
            ...project.scene,
            objects: [modified],
            layers:
              kind === 'hidden'
                ? project.scene.layers.map((layer) => ({ ...layer, visible: false }))
                : project.scene.layers,
          },
        },
      });
      const before = useStore.getState();
      const expected =
        kind === 'locked' || kind === 'hidden' ? 'not_editable' : 'unsupported_operation';
      expect(
        resultCode(
          await adapter.execute(
            'update_text',
            writeArgs(adapter, { artworkId: original.id, patch: { text: 'Changed' } }),
          ),
        ),
      ).toBe(expected);
      expect(useStore.getState()).toBe(before);
    },
  );
});
