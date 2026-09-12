import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextObject } from '../../core/scene';
import type { TextRenderResult } from '../../core/text';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useCanvasTextStore } from './canvas-text-store';

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

let host: HTMLDivElement;
let root: Root;
const rendered: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
  paths: [
    {
      color: '#000000',
      polylines: [0, 10].map((x) => ({
        closed: true,
        points: [
          { x, y: 0 },
          { x: x + 20, y: 0 },
          { x: x + 20, y: 10 },
          { x, y: 10 },
        ],
      })),
    },
  ],
};

beforeEach(async () => {
  vi.useFakeTimers();
  resetStore();
  useCanvasTextStore.getState().close();
  useUiStore.setState({
    toolMode: { kind: 'text' },
    textDialog: null,
    imageDialog: null,
    modalDepth: 0,
  });
  mocks.render.mockReset();
  mocks.render.mockResolvedValue(rendered);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<EditorHarness />));
  await act(async () => useCanvasTextStore.getState().beginAdd({ x: 76, y: 89 }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useCanvasTextStore.getState().close();
  resetStore();
  vi.useRealTimers();
});

describe('canvas text overlap welding', () => {
  it('previews weld changes and saves a weld-only edit as one undoable text change', async () => {
    await act(async () => {
      const input = host.querySelector('textarea[aria-label="Text content on canvas"]');
      if (!(input instanceof HTMLTextAreaElement)) throw new Error('Canvas text input missing');
      input.value = 'my';
      Simulate.change(input);
    });
    await settlePreview();
    expect(weld().checked).toBe(true);
    expect(useCanvasTextStore.getState().draft?.paths[0]?.polylines).toHaveLength(1);
    await setWeld(false);
    expect(useCanvasTextStore.getState().draft?.paths[0]?.polylines).toHaveLength(2);
    await done();
    const original = currentText();
    expect(original.weldOverlaps).toBe(false);
    const before = useStore.getState().project;
    const undo = useStore.getState().undoStack.length;
    await act(async () => useCanvasTextStore.getState().beginEdit(original));
    await setWeld(true);
    expect(useCanvasTextStore.getState().draft?.paths[0]?.polylines).toHaveLength(1);
    expect(useStore.getState().project).toBe(before);
    await done();
    expect(currentText()).toMatchObject({ kind: 'text', content: 'my', weldOverlaps: true });
    expect(currentText().paths[0]?.polylines).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(undo + 1);
    await act(async () => useStore.getState().undo());
    expect(currentText()).toBe(original);
  });
});

function EditorHarness(): JSX.Element {
  const project = useStore((state) => state.project);
  return (
    <CanvasTextEditor
      canvasRef={{ current: null }}
      canvasSize={{ width: 800, height: 600 }}
      project={project}
      viewState={{ zoomFactor: 1, panX: 0, panY: 0 }}
    />
  );
}

function weld(): HTMLInputElement {
  const element = host.querySelector('input[aria-label="Weld overlapping letters"]');
  if (!(element instanceof HTMLInputElement)) throw new Error('Weld option missing');
  return element;
}

async function setWeld(checked: boolean): Promise<void> {
  await act(async () => {
    weld().checked = checked;
    Simulate.change(weld());
  });
  await settlePreview();
}

async function settlePreview(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(65));
}

async function done(): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Done',
  );
  if (button === undefined) throw new Error('Done button missing');
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function currentText(): TextObject {
  const object = useStore
    .getState()
    .project.scene.objects.find((candidate) => candidate.kind === 'text');
  if (object?.kind !== 'text') throw new Error('Saved text missing');
  return object;
}
