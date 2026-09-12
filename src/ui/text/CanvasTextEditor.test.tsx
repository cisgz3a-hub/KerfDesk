import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import { DEFAULT_FONT_KEY, type TextRenderResult } from '../../core/text';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { computeView } from '../workspace/view-transform';
import { workspaceTextPointerHandlers } from '../workspace/workspace-text-interaction';
import { useCanvasTextStore } from './canvas-text-store';
import type { RenderTextGeometryInput } from './render-text-geometry';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./render-text-geometry', () => ({ renderTextGeometry: mocks.render }));
vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: vi.fn(async () => undefined),
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
}));
import { CanvasTextEditor } from './CanvasTextEditor';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SIZE = { width: 800, height: 600 };
const VIEW = { zoomFactor: 1.5, panX: 12, panY: -8 };
let host: HTMLDivElement;
let root: Root;
let canvas: HTMLCanvasElement;
let canvasRef: { current: HTMLCanvasElement };

beforeEach(async () => {
  vi.useFakeTimers();
  resetStore();
  useCanvasTextStore.getState().close();
  useUiStore.setState({
    toolMode: { kind: 'text' },
    spaceDown: false,
    modalDepth: 0,
    textDialog: null,
    imageDialog: null,
  });
  mocks.render.mockReset();
  mocks.render.mockImplementation(async (input: RenderTextGeometryInput) => geometry(input.color));
  host = document.createElement('div');
  canvas = document.createElement('canvas');
  canvas.width = SIZE.width;
  canvas.height = SIZE.height;
  canvas.getBoundingClientRect = () => new DOMRect(20, 30, 400, 300);
  canvasRef = { current: canvas };
  document.body.append(host, canvas);
  root = createRoot(host);
  await act(async () => root.render(<EditorHarness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  canvas.remove();
  useCanvasTextStore.getState().close();
  resetStore();
  vi.useRealTimers();
});

describe('canvas text editing', () => {
  it('keeps a clicked draft outside project/history and commits its position in one undo step', async () => {
    const before = useStore.getState();
    await clickToAdd({ x: 76, y: 89 });
    expect(document.activeElement).toBe(input());
    await typeText('First');
    await settlePreview();
    await typeText('Final\nline');
    await settlePreview();
    expect(useCanvasTextStore.getState().draft?.content).toBe('Final\nline');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().pendingUndo).toBeNull();

    await clickButton('Done');
    const saved = currentText();
    expect(saved.content).toBe('Final\nline');
    expect(saved.transform.x).toBeCloseTo(76);
    expect(saved.transform.y).toBeCloseTo(89);
    expect(useStore.getState().undoStack).toEqual([before.project]);
    expect(useStore.getState().selectedObjectId).toBe(saved.id);
    expect(useCanvasTextStore.getState().session).toBeNull();

    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    await act(async () => useStore.getState().redo());
    expect(currentText()).toEqual(saved);
  });

  it('preserves edit transforms, operation bindings and settings while changing text', async () => {
    const original = await arrangeExistingText();
    const before = useStore.getState().project;
    await act(async () => useCanvasTextStore.getState().beginEdit(original));
    await typeText('Changed');
    await settlePreview();
    expect(useStore.getState().project).toBe(before);
    expect(useCanvasTextStore.getState().draft?.transform).toEqual(original.transform);
    await clickButton('Done');

    const saved = currentText();
    expect(saved.content).toBe('Changed');
    expect(saved.id).toBe(original.id);
    expect(saved.transform).toEqual(original.transform);
    expect(saved.operationIds).toEqual(original.operationIds);
    expect(saved.paths[0]?.operationIds).toEqual(original.paths[0]?.operationIds);
    expect(saved.operationOverride).toEqual(original.operationOverride);
    expect(saved.powerScale).toBe(original.powerScale);
    expect(useStore.getState().project.scene.layers).toEqual(before.scene.layers);
    expect(useStore.getState().undoStack).toEqual([before]);
    await act(async () => useStore.getState().undo());
    expect(currentText()).toEqual(original);
  });

  it('cancels edited content with Escape and leaves the original project untouched', async () => {
    const original = await arrangeExistingText();
    const before = useStore.getState().project;
    await act(async () => useCanvasTextStore.getState().beginEdit(original));
    await typeText('Discard this');
    await settlePreview();
    const event = await pressKey('Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(useCanvasTextStore.getState().session).toBeNull();
    expect(useCanvasTextStore.getState().draft).toBeNull();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('finishes an unchanged edit without adding an undo step', async () => {
    const original = await arrangeExistingText();
    const before = useStore.getState().project;
    await act(async () => useCanvasTextStore.getState().beginEdit(original));
    await settlePreview();
    await clickButton('Done');
    expect(useCanvasTextStore.getState().session).toBeNull();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('finishes an empty new session without adding artwork or history', async () => {
    const before = useStore.getState().project;
    await beginAdd();
    await typeText(' \n ');
    await clickButton('Done');
    expect(useCanvasTextStore.getState().session).toBeNull();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('keeps plain Enter for multiline input and saves once with Ctrl+Enter', async () => {
    await beginAdd();
    await typeText('One');
    const newline = await pressKey('Enter');
    expect(newline.defaultPrevented).toBe(false);
    expect(useCanvasTextStore.getState().session).not.toBeNull();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    // jsdom does not perform the browser's native textarea insertion.
    await typeText('One\nTwo');
    const finish = await pressKey('Enter', { ctrlKey: true });
    expect(finish.defaultPrevented).toBe(true);
    expect(currentText().content).toBe('One\nTwo');
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it.each([
    { key: 'Enter', ctrlKey: true, isComposing: true },
    { key: 'Escape', isComposing: true },
    { key: 'Enter', ctrlKey: true, keyCode: 229 },
  ])('does not finish or cancel IME composition on $key', async (keys) => {
    await beginAdd();
    await typeText('你好');
    const session = useCanvasTextStore.getState().session;
    const { key, ...options } = keys;
    const event = await pressKey(key, options);
    expect(event.defaultPrevented).toBe(false);
    expect(useCanvasTextStore.getState().session).toBe(session);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    await pressKey('Enter', { metaKey: true });
    expect(currentText().content).toBe('你好');
  });

  it.each(['new-project', 'new-session', 'unmount'] as const)(
    'ignores a delayed save after %s',
    async (retire) => {
      await beginAdd();
      await typeText('Pending');
      const pending = deferredRender();
      mocks.render.mockReturnValueOnce(pending.promise);
      await clickButton('Done');
      expect(input().readOnly).toBe(true);
      expect(host.querySelector('input[aria-label="Text size"]')?.matches(':disabled')).toBe(true);
      await act(async () => {
        if (retire === 'new-project') useStore.getState().newProject();
        else if (retire === 'new-session')
          useCanvasTextStore.getState().beginAdd({ x: 110, y: 120 });
        else root.render(null);
      });
      const project = useStore.getState().project;
      const session = useCanvasTextStore.getState().session;
      await act(async () => pending.resolve(geometry()));
      expect(useStore.getState().project).toBe(project);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(useCanvasTextStore.getState().session).toBe(session);
      if (retire === 'new-session') expect(input().value).toBe('');
      else expect(session).toBeNull();
    },
  );

  it('does not let an older draft replace the latest typed preview', async () => {
    await beginAdd();
    const pending = deferredRender();
    mocks.render.mockReturnValueOnce(pending.promise);
    await typeText('Old');
    await settlePreview();
    await typeText('Latest');
    await settlePreview();
    expect(useCanvasTextStore.getState().draft?.content).toBe('Latest');
    await act(async () => pending.resolve(geometry()));
    expect(useCanvasTextStore.getState().draft?.content).toBe('Latest');
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });

  it('saves on a primary canvas click and prevents that click starting another interaction', async () => {
    await beginAdd();
    await typeText('Click to finish');
    const event = new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true });
    const canvasListener = vi.fn();
    canvas.addEventListener('pointerdown', canvasListener);
    await act(async () => {
      canvas.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(canvasListener).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(currentText().content).toBe('Click to finish');
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('remains editable and saves exactly once through StrictMode effect replay', async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <EditorHarness />
        </StrictMode>,
      ),
    );
    await beginAdd();
    expect(useCanvasTextStore.getState().session).not.toBeNull();
    await typeText('Strict text');
    await settlePreview();
    await clickButton('Done');
    expect(currentText().content).toBe('Strict text');
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

function EditorHarness(): JSX.Element {
  const project = useStore((state) => state.project);
  return (
    <CanvasTextEditor canvasRef={canvasRef} canvasSize={SIZE} project={project} viewState={VIEW} />
  );
}

async function beginAdd(): Promise<void> {
  await act(async () => useCanvasTextStore.getState().beginAdd({ x: 35, y: 45 }));
}

async function clickToAdd(position: { x: number; y: number }): Promise<void> {
  const project = useStore.getState().project;
  const view = computeView(
    SIZE.width,
    SIZE.height,
    project.device.bedWidth,
    project.device.bedHeight,
    VIEW,
  );
  const handlers = workspaceTextPointerHandlers({
    canvasRef,
    project,
    viewState: VIEW,
    previewMode: false,
    handlers: {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
      onLostPointerCapture: vi.fn(),
    },
  });
  await act(async () =>
    handlers.onPointerDown({
      button: 0,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      clientX: 20 + (view.offsetX + position.x * view.scale) / 2,
      clientY: 30 + (view.offsetY + position.y * view.scale) / 2,
    } as unknown as React.PointerEvent<HTMLCanvasElement>),
  );
}

function input(): HTMLTextAreaElement {
  const element = host.querySelector('textarea[aria-label="Text content on canvas"]');
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('Canvas text input missing');
  return element;
}

async function typeText(content: string): Promise<void> {
  await act(async () => {
    const element = input();
    element.value = content;
    Simulate.change(element);
  });
}

async function settlePreview(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(65));
}

async function clickButton(label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`${label} button missing`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function pressKey(key: string, options: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, ...options, bubbles: true, cancelable: true });
  await act(async () => {
    input().dispatchEvent(event);
  });
  return event;
}

function currentText(): TextObject {
  const object = useStore
    .getState()
    .project.scene.objects.find((candidate) => candidate.kind === 'text');
  if (object?.kind !== 'text') throw new Error('Saved text missing');
  return object;
}

function geometry(color = '#ff0000'): TextRenderResult {
  return {
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

async function arrangeExistingText(): Promise<TextObject> {
  const original: TextObject = {
    ...geometry(),
    kind: 'text',
    id: 'existing-text',
    content: 'Original',
    fontKey: DEFAULT_FONT_KEY,
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#ff0000',
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 80,
      y: 70,
      rotationDeg: 35,
      scaleX: 1.5,
      scaleY: 0.8,
      mirrorX: true,
      mirrorY: true,
    },
    operationIds: ['text-operation'],
    operationOverride: { power: 17, speed: 800 },
    powerScale: 65,
    paths: geometry().paths.map((path) => ({ ...path, operationIds: ['text-operation'] })),
  };
  const project = useStore.getState().project;
  await act(async () =>
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: [original],
          layers: [createLayer({ id: 'text-operation', color: '#ff0000', mode: 'fill' })],
        },
      },
    }),
  );
  return original;
}

function deferredRender() {
  let resolve!: (value: TextRenderResult) => void;
  const promise = new Promise<TextRenderResult>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
