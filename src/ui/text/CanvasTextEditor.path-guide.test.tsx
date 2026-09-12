import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type TextObject,
} from '../../core/scene';
import type { TextRenderResult } from '../../core/text';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useCanvasTextStore, type CanvasTextSession } from './canvas-text-store';
import { useCanvasTextVariables } from './use-canvas-text-variables';
import type { DialogValues } from './use-text-dialog-fields';
import type * as CanvasTextDraft from './use-canvas-text-draft';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./render-text-geometry', () => ({ renderTextGeometry: mocks.render }));
vi.mock('./use-canvas-text-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof CanvasTextDraft>();
  return { ...actual, buildCanvasTextObject: vi.fn(actual.buildCanvasTextObject) };
});
import { buildTextObject } from './build-text-object';
import { buildCanvasTextObject } from './use-canvas-text-draft';
import { useCanvasTextActions } from './use-canvas-text-actions';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const GUIDE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'guide',
  source: 'guide.svg',
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 0 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 120, y: 0 },
          ],
        },
      ],
    },
  ],
};
const RENDERED: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 10 },
            { x: 10, y: 0 },
            { x: 20, y: 10 },
          ],
        },
      ],
    },
  ],
};
const VALUES: DialogValues = {
  content: 'Names',
  fontKey: 'roboto-regular',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.4,
  letterSpacing: 0,
  bendDeg: 0,
  weldOverlaps: false,
  color: '#000000',
  embeddedFonts: [],
  pathText: { guideObjectId: GUIDE.id, offsetMm: 0, reverse: false },
};
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  resetStore();
  useCanvasTextStore.getState().close();
  useUiStore.setState({ toolMode: { kind: 'text' } });
  mocks.render.mockReset();
  mocks.render.mockResolvedValue(RENDERED);
  vi.mocked(buildCanvasTextObject).mockClear();
  const project = useStore.getState().project;
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects: [GUIDE] } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useCanvasTextStore.getState().close();
  resetStore();
});

describe('canvas path-text save ownership', () => {
  it.each(['moved', 'reshaped'] as const)(
    'commits rebuilt geometry for an unchanged text edit after its guide is %s',
    async (change) => {
      const original = await arrangeText();
      const guide = changedGuide(change);
      await replaceGuide(guide);
      const before = useStore.getState().project;
      const undo = useStore.getState().undoStack.length;
      const expected = await buildTextObject({ mode: 'add' }, { ...VALUES, pathGuide: guide });
      await act(async () => useCanvasTextStore.getState().beginEdit(original));
      await click('Done');
      const saved = currentText();
      expect(saved).not.toBe(original);
      expect(saved.transform).toEqual(expected.transform);
      expect(saved.bounds).toEqual(expected.bounds);
      expect(saved.paths.map((path) => path.polylines)).toEqual(
        expected.paths.map((path) => path.polylines),
      );
      expect(useStore.getState().undoStack).toHaveLength(undo + 1);
      await act(async () => useStore.getState().undo());
      expect(useStore.getState().project).toBe(before);
      expect(currentText()).toBe(original);
    },
  );

  it('keeps an unchanged path-text edit out of history regardless of JSON property order', async () => {
    const text = await arrangeText();
    const original = {
      ...text,
      transform: {
        mirrorY: text.transform.mirrorY,
        mirrorX: text.transform.mirrorX,
        rotationDeg: text.transform.rotationDeg,
        scaleY: text.transform.scaleY,
        scaleX: text.transform.scaleX,
        y: text.transform.y,
        x: text.transform.x,
      },
    };
    await act(async () => {
      const project = useStore.getState().project;
      useStore.setState({
        project: { ...project, scene: { ...project.scene, objects: [GUIDE, original] } },
      });
      useCanvasTextStore.getState().beginEdit(original);
    });
    const before = useStore.getState();
    await click('Done');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useCanvasTextStore.getState().session).toBeNull();
  });

  it.each(['deleted', 'replaced'] as const)(
    'rejects a late new-text save whose captured guide was %s',
    async (change) => {
      await act(async () => useCanvasTextStore.getState().beginAdd({ x: 30, y: 40 }));
      const pending = deferredRender();
      mocks.render.mockReturnValueOnce(pending.promise);
      await click('Done');
      await act(async () => {
        if (change === 'deleted') useStore.getState().removeSceneObject(GUIDE.id);
        else setGuide(changedGuide('moved'));
      });
      const before = useStore.getState();
      await act(async () => pending.resolve(RENDERED));
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('guide path changed');
      expect(useCanvasTextStore.getState().session).not.toBeNull();
      if (change === 'replaced') {
        await click('Done');
        expect(currentText().transform.y).toBe(70);
        expect(useStore.getState().undoStack).toHaveLength(before.undoStack.length + 1);
      }
    },
  );

  it.each(['cancel', 'unmount'] as const)(
    'aborts in-flight rendering on %s without a late commit',
    async (finish) => {
      await act(async () => useCanvasTextStore.getState().beginAdd({ x: 30, y: 40 }));
      const pending = deferredRender();
      mocks.render.mockReturnValueOnce(pending.promise);
      const before = useStore.getState();
      await click('Done');
      const signal = vi.mocked(buildCanvasTextObject).mock.lastCall?.[2];
      expect(signal?.aborted).toBe(false);
      if (finish === 'cancel') await click('Cancel');
      else await act(async () => root.render(null));
      expect(signal?.aborted).toBe(true);
      await act(async () => pending.resolve(RENDERED));
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(host.querySelector('[role="alert"]')).toBeNull();
    },
  );
});

function Harness(): JSX.Element | null {
  const project = useStore((state) => state.project);
  const session = useCanvasTextStore((state) => state.session);
  return session === null ? null : (
    <ActionsHarness key={session.id} session={session} project={project} />
  );
}

function ActionsHarness({
  session,
  project,
}: {
  readonly session: CanvasTextSession;
  readonly project: Project;
}): JSX.Element {
  const variables = useCanvasTextVariables(project);
  const pathGuide = project.scene.objects.find((object) => object.id === GUIDE.id);
  const values = { ...VALUES, ...(pathGuide === undefined ? {} : { pathGuide }) };
  const actions = useCanvasTextActions(session, values, variables);
  return (
    <>
      <button disabled={actions.saving} onClick={() => void actions.save()}>
        Done
      </button>
      <button onClick={actions.cancel}>Cancel</button>
      {actions.error !== null && <p role="alert">{actions.error}</p>}
    </>
  );
}

async function arrangeText(): Promise<TextObject> {
  const text = await buildTextObject({ mode: 'add' }, { ...VALUES, pathGuide: GUIDE });
  await act(async () => useStore.getState().upsertTextObject(text));
  return currentText();
}

function currentText(): TextObject {
  const text = useStore.getState().project.scene.objects.find((object) => object.kind === 'text');
  if (text?.kind !== 'text') throw new Error('Saved text missing');
  return text;
}

function changedGuide(change: 'moved' | 'reshaped'): ImportedSvg {
  if (change === 'moved') return { ...GUIDE, transform: { ...GUIDE.transform, y: 80 } };
  return {
    ...GUIDE,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 15, y: 10 },
              { x: 120, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

function setGuide(guide: ImportedSvg): void {
  const project = useStore.getState().project;
  const objects = project.scene.objects.map((object) => (object.id === guide.id ? guide : object));
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects } } });
}

async function replaceGuide(guide: ImportedSvg): Promise<void> {
  await act(async () => setGuide(guide));
}

async function click(label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`${label} button missing`);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function deferredRender() {
  let resolve!: (value: TextRenderResult) => void;
  const promise = new Promise<TextRenderResult>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
