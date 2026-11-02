// Rolling audit v9 R3-P2-3 (ADR-494 Amendment 4): a text edit kept tabs by contour
// index, so a letter put in front left them on other letters and a letter taken
// away left an anchor that resolved to nothing. An edit that changes the glyph run
// now drops the tabs whose contour is no longer the same outline and says how many.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { laserTabAnchorPosition } from '../../core/job/laser-tab-anchors';
import { IDENTITY_TRANSFORM, type TextObject, type Vec2 } from '../../core/scene';
import { textToPolylines } from '../../core/text';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { upsertJigText } from '../workspace/registration-jig/jig-editor-artwork';
import { createJigEditorSession } from '../workspace/registration-jig/jig-editor-session';
import { cncTabRises, expectSamePoints } from './placed-tabs.test-support';
import { useStore } from './store';
import { TAB_COLOR, expectTabsAt, tabbedProject, withPlacedTabs } from './placed-tabs.test-support';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const SIZE_MM = 20;

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

function fontBytes(file: string): ArrayBuffer {
  const bytes = readFileSync(resolve(process.cwd(), 'src/ui/text/fonts', file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function rendered(
  content: string,
  options: {
    readonly file?: string;
    readonly fontKey?: string;
    readonly sizeMm?: number;
    readonly letterSpacing?: number;
    readonly color?: string;
  } = {},
): Promise<TextObject> {
  const sizeMm = options.sizeMm ?? SIZE_MM;
  const letterSpacing = options.letterSpacing ?? 0;
  const color = options.color ?? TAB_COLOR;
  const result = await textToPolylines({
    fontBuffer: fontBytes(options.file ?? 'Roboto-Regular.ttf'),
    content,
    sizeMm,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing,
    color,
  });
  return {
    kind: 'text',
    id: 'text',
    content,
    fontKey: options.fontKey ?? 'roboto-regular',
    sizeMm,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing,
    color,
    bounds: result.bounds,
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
    paths: result.paths.map((path) => ({ ...path, operationIds: ['cut'] })),
  };
}

// "AB" with a laser and a CNC tab on the outer contour of each letter. Contours:
// A 0, 1; B 2, 3, 4.
async function loadAB(): Promise<TextObject> {
  const text = await rendered('AB');
  const first = pointOf(text, 0);
  const second = pointOf(text, 2);
  const tabbed = withPlacedTabs({ ...text, operationIds: ['cut'] }, [first, second]);
  expect(tabbed.laserTabAnchors?.map((anchor) => anchor.polylineIndex)).toEqual([0, 2]);
  useStore.setState({
    project: tabbedProject([tabbed]),
    selectedObjectId: tabbed.id,
    additionalSelectedIds: new Set(),
    dirty: false,
  });
  return tabbed;
}

function pointOf(text: TextObject, contour: number): Vec2 {
  const point = text.paths[0]?.polylines[contour]?.points[0];
  if (point === undefined) throw new Error('no such contour');
  return { x: point.x + text.transform.x, y: point.y + text.transform.y };
}

function current(): TextObject {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'text') throw new Error('the text is gone');
  return object;
}

function messages(): ReadonlyArray<string> {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

function expectNoNullAnchor(): void {
  const object = current();
  for (const anchor of object.laserTabAnchors ?? []) {
    expect(laserTabAnchorPosition(object, anchor)).not.toBeNull();
  }
}

describe('a text edit that changes the glyph run', () => {
  it('"XAB" drops the tabs it would have left on X and on the counter of A', async () => {
    const before = await loadAB();

    useStore.getState().upsertTextObject(await rendered('XAB'));

    expect(current().laserTabAnchors).toBeUndefined();
    expect(current().cncTabAnchors).toBeUndefined();
    expect(messages()).toContain(
      '4 placed tabs were on letters this edit changed, so they were removed. Undo restores them.',
    );
    useStore.getState().undo();
    expect(current()).toEqual(before);
    useStore.getState().redo();
    expect(current().laserTabAnchors).toBeUndefined();
  });

  it('"BA" drops both rather than putting both on B', async () => {
    await loadAB();

    useStore.getState().upsertTextObject(await rendered('BA'));

    expect(current().laserTabAnchors).toBeUndefined();
    expect(messages().join()).toContain('4 placed tabs');
  });

  it('"A" keeps the tab on A and drops the one that would resolve to nothing', async () => {
    const before = await loadAB();

    useStore.getState().upsertTextObject(await rendered('A'));

    expect(current().laserTabAnchors).toEqual([before.laserTabAnchors?.[0]]);
    expect(current().cncTabAnchors).toEqual([before.cncTabAnchors?.[0]]);
    expectNoNullAnchor();
    expect(messages()).toContain(
      '2 placed tabs were on letters this edit changed, so they were removed. Undo restores them.',
    );
  });

  it('"ABC" keeps both, on their own letters', async () => {
    const before = await loadAB();

    useStore.getState().upsertTextObject(await rendered('ABC'));

    expect(current().laserTabAnchors).toEqual(before.laserTabAnchors);
    expectNoNullAnchor();
    expect(messages()).toEqual([]);
  });

  it('a font change drops the tabs instead of keeping a fraction of another outline', async () => {
    await loadAB();

    useStore
      .getState()
      .upsertTextObject(await rendered('AB', { file: 'Anton-Regular.ttf', fontKey: 'anton' }));

    expect(current().laserTabAnchors).toBeUndefined();
    expect(messages().join()).toContain('4 placed tabs');
  });
});

describe('what a dropped tab leaves behind', () => {
  it('burns and cuts "XAB" exactly as the same text that never had a placed tab', async () => {
    await loadAB();
    const edited = await rendered('XAB');
    useStore.getState().upsertTextObject(edited);
    const after = current();
    const twin = { ...edited, operationIds: ['cut'] };

    // Before the fix a stale tab stayed on the counter of A, and none on B.
    expect(emitGcode(useStore.getState().project).gcode).toBe(
      emitGcode(tabbedProject([twin])).gcode,
    );
    expectSamePoints(
      cncTabRises(after, 'profile-on-path'),
      cncTabRises(twin, 'profile-on-path'),
      1e-9,
    );
  });

  it('a jig text edit follows the same rule instead of dropping every tab', async () => {
    const before = await loadAB();
    const session = createJigEditorSession(useStore.getState());

    const edited = upsertJigText(session, await rendered('A'));

    const object = edited.draft.project.scene.objects.find((item) => item.id === before.id);
    expect(object?.laserTabAnchors).toEqual([before.laserTabAnchors?.[0]]);
    expect(object?.cncTabAnchors).toEqual([before.cncTabAnchors?.[0]]);
  });
});

describe('controls: an edit that keeps the glyph run keeps every tab', () => {
  it('a size change', async () => {
    const before = await loadAB();

    useStore.getState().upsertTextObject(await rendered('AB', { sizeMm: 40 }));

    expect(current().laserTabAnchors).toEqual(before.laserTabAnchors);
    expect(messages()).toEqual([]);
  });

  it('a letter spacing change keeps each tab on its own letter', async () => {
    await loadAB();

    useStore.getState().upsertTextObject(await rendered('AB', { letterSpacing: 0.2 }));

    const next = current();
    expectTabsAt(next, [pointOf(next, 0), pointOf(next, 2)], 1e-6);
    expect(messages()).toEqual([]);
  });

  it('a colour change keeps the tabs on the recoloured path', async () => {
    await loadAB();

    useStore.getState().upsertTextObject(await rendered('AB', { color: '#ff0000' }));

    expect(current().laserTabAnchors?.map((anchor) => anchor.layerColor)).toEqual([
      '#ff0000',
      '#ff0000',
    ]);
    expectNoNullAnchor();
    expect(messages()).toEqual([]);
  });

  it('a text with no placed tabs gets none and says nothing', async () => {
    const plain = await rendered('AB');
    useStore.setState({
      project: tabbedProject([plain]),
      selectedObjectId: plain.id,
      additionalSelectedIds: new Set(),
      dirty: false,
    });

    useStore.getState().upsertTextObject(await rendered('XAB'));

    expect('laserTabAnchors' in current()).toBe(false);
    expect('cncTabAnchors' in current()).toBe(false);
    expect(messages()).toEqual([]);
  });
});
