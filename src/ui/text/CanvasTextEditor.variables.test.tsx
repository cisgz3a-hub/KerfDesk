import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ],
        },
      ],
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
  await act(async () => useCanvasTextStore.getState().beginAdd({ x: 35, y: 45 }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useCanvasTextStore.getState().close();
  resetStore();
  vi.useRealTimers();
});

describe('canvas text and variable commit ownership', () => {
  it.each(['escape', 'empty-done'] as const)(
    'discards staged serial data on %s',
    async (finish) => {
      const before = useStore.getState();
      await stageSerial(41);
      if (finish === 'escape') {
        await typeText('Discard {{serial:4}}');
        await act(async () => {
          input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
      } else await done();
      expect(useCanvasTextStore.getState().session).toBeNull();
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(useStore.getState().dirty).toBe(false);
    },
  );

  it('commits text and staged variables in one undo step and restores both on undo/redo', async () => {
    const before = useStore.getState().project;
    await stageSerial(41);
    await typeText('Part {{serial:4}}');
    await act(async () => vi.advanceTimersByTimeAsync(65));
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    await done();
    const saved = useStore.getState().project;
    expect(saved.scene.objects).toHaveLength(1);
    expect(saved.scene.objects[0]).toMatchObject({
      kind: 'text',
      content: 'Part {{serial:4}}',
      transform: { x: 35, y: 45 },
    });
    expect(saved.variables?.serialValue).toBe(41);
    expect(useStore.getState().undoStack).toEqual([before]);
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().project.variables).toBeUndefined();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    await act(async () => useStore.getState().redo());
    expect(useStore.getState().project).toBe(saved);
  });

  it('does not overwrite external variable changes when a staged save resolves late', async () => {
    await stageSerial(41);
    await typeText('Part {{serial:4}}');
    let resolve!: (value: TextRenderResult) => void;
    mocks.render.mockReturnValueOnce(
      new Promise<TextRenderResult>((yes) => {
        resolve = yes;
      }),
    );
    await done();
    expect(input().readOnly).toBe(true);
    await act(async () => useStore.getState().setVariableSettings({ serialValue: 99 }));
    const external = useStore.getState().project;
    await act(async () => resolve(rendered));
    expect(useCanvasTextStore.getState().session).toBeNull();
    expect(useStore.getState().project).toBe(external);
    expect(useStore.getState().project.variables?.serialValue).toBe(99);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(1);
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

function input(): HTMLTextAreaElement {
  const element = host.querySelector('textarea[aria-label="Text content on canvas"]');
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('Canvas text input missing');
  return element;
}

async function stageSerial(value: number): Promise<void> {
  const toggle = host.querySelector('section[aria-label="Variable text"] input[type="checkbox"]');
  if (!(toggle instanceof HTMLInputElement)) throw new Error('Variable toggle missing');
  await act(async () => {
    toggle.checked = true;
    Simulate.change(toggle);
  });
  const serial = host.querySelector('input[aria-label="Variable serial"]');
  if (!(serial instanceof HTMLInputElement)) throw new Error('Variable serial input missing');
  await act(async () => {
    serial.value = String(value);
    Simulate.change(serial);
  });
}

async function typeText(content: string): Promise<void> {
  await act(async () => {
    const element = input();
    element.value = content;
    Simulate.change(element);
  });
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
