// Ctrl+. reaches the software Abort from every surface that keeps its keys to
// itself (audit 27-P2-1, PROJECT.md non-negotiable 9). Each case mounts the real
// component during a streaming job and presses the chord from inside it. The
// surface still stops the key before a window bubble listener hears it, which is
// why the Abort listener runs in the capture phase.

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { getStudioStatus } from '../artcraft-studio/artcraft-api';
import { DesktopEditorsPanel } from '../artcraft-studio/DesktopEditorsPanel';
import { disposeStudioProjectBridge } from '../artcraft-studio/studio-project-bridge';
import { AdjustDialogPanel } from '../image-editor/AdjustDialog';
import { useAdjustDialogStore } from '../image-editor/adjust-dialog-store';
import { ColorPickerDialog } from '../image-editor/ColorPickerDialog';
import { createSession } from '../image-editor/editor-session';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { ResizeDialogPanel } from '../image-editor/ResizeDialog';
import { useResizeDialogStore } from '../image-editor/resize-dialog-store';
import { TextDialog } from '../image-editor/TextDialog';
import { useTextDialogStore } from '../image-editor/text-dialog-store';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useCanvasTextStore } from '../text/canvas-text-store';
import { CanvasTextEditor } from '../text/CanvasTextEditor';
import { installAbortShortcut } from './use-job-shortcuts';

vi.mock('../text/render-text-geometry', () => ({
  renderTextGeometry: () => new Promise(() => undefined),
}));
vi.mock('../text/font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: async () => undefined,
  loadFont: async () => new ArrayBuffer(8),
}));
vi.mock('../image-editor/editor-text-raster', () => ({ rasterizeTextLayer: vi.fn() }));
vi.mock('../artcraft-studio/artcraft-api', () => ({
  getStudioStatus: vi.fn(),
  getStudioSnapshot: vi.fn(),
  openStudioEditor: vi.fn(),
  resumeStudioEditor: vi.fn(),
  restoreStudioDocument: vi.fn(),
  captureStudioDocument: vi.fn(),
  hostStudioEditor: vi.fn(async () => ({})),
  hideStudioEditor: vi.fn(async () => ({})),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const realStopJob = useLaserStore.getState().stopJob;
const stopJob = vi.fn(async () => undefined);
const bubbled = vi.fn();
const roots: Root[] = [];
let uninstall: () => void = () => undefined;

beforeEach(() => {
  resetStore();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* no layout in jsdom */
      }
      disconnect(): void {
        /* no layout in jsdom */
      }
    },
  );
  useUiStore.setState({ toolMode: { kind: 'text' }, modalDepth: 0 });
  useImageEditorStore.setState({
    session: createSession('abort', 'abort.png', createRgbaBuffer(8, 4), {
      minX: 0,
      minY: 0,
      maxX: 8,
      maxY: 4,
    }),
    sessionOwner: null,
    transform: null,
  });
  vi.mocked(getStudioStatus).mockResolvedValue({
    available: true,
    editors: {
      vector: { installed: true, version: '1' },
      photo: { installed: true, version: '1' },
    },
    sessions: [],
  });
  stopJob.mockClear();
  useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state, stopJob });
  uninstall = installAbortShortcut(window);
  window.addEventListener('keydown', bubbled);
});

afterEach(async () => {
  window.removeEventListener('keydown', bubbled);
  bubbled.mockClear();
  uninstall();
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  useCanvasTextStore.getState().close();
  useAdjustDialogStore.setState({ dialog: null });
  useResizeDialogStore.setState({ dialog: null });
  useTextDialogStore.getState().close();
  useImageEditorStore.setState({ session: null });
  disposeStudioProjectBridge();
  useLaserStore.setState({ ...initialLaserState(), stopJob: realStopJob });
  resetStore();
  vi.unstubAllGlobals();
});

async function mount(node: ReactNode): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
}

function inside(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`Surface control missing: ${selector}`);
  return element;
}

const textCanvasRef = { current: document.createElement('canvas') };

function CanvasTextHarness(): JSX.Element {
  const project = useStore((state) => state.project);
  return (
    <CanvasTextEditor
      canvasRef={textCanvasRef}
      canvasSize={{ width: 800, height: 600 }}
      project={project}
      viewState={{ zoomFactor: 1, panX: 0, panY: 0 }}
    />
  );
}

const SURFACES: ReadonlyArray<readonly [string, () => Promise<Element>]> = [
  [
    'canvas text editor',
    async () => {
      await act(async () => useCanvasTextStore.getState().beginAdd({ x: 35, y: 45 }));
      await mount(<CanvasTextHarness />);
      return inside('textarea[aria-label="Text content on canvas"]');
    },
  ],
  [
    'Image Studio Adjust dialog',
    async () => {
      useAdjustDialogStore.getState().open('brightness-contrast');
      await mount(<AdjustDialogPanel />);
      return inside('[role="dialog"] input');
    },
  ],
  [
    'Image Studio Colour dialog',
    async () => {
      await mount(
        <ColorPickerDialog
          title="Ink colour"
          initial={{ r: 0, g: 0, b: 0 }}
          onCommit={() => undefined}
          onClose={() => undefined}
        />,
      );
      return inside('[aria-label="Ink percent"]');
    },
  ],
  [
    'Image Studio Resize dialog',
    async () => {
      useResizeDialogStore.getState().open('image-size');
      await mount(<ResizeDialogPanel />);
      return inside('[role="dialog"] input');
    },
  ],
  [
    'Image Studio Text dialog',
    async () => {
      useTextDialogStore.getState().open();
      await mount(<TextDialog />);
      return inside('[role="dialog"] textarea');
    },
  ],
  [
    'desktop Editors panel',
    async () => {
      await mount(<DesktopEditorsPanel onClose={() => undefined} />);
      return inside('.artcraft-backdrop button');
    },
  ],
];

it.each(SURFACES)('Ctrl+. aborts a streaming job from the %s', async (_surface, open) => {
  const target = await open();
  const event = new KeyboardEvent('keydown', {
    key: '.',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });

  await act(async () => target.dispatchEvent(event));

  expect(stopJob).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
  expect(bubbled).not.toHaveBeenCalled();
});
