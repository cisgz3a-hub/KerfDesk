import type * as FrameSourceModule from '../camera/frame-source';
import type * as ImageLoaderModule from './image-loader';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, vi } from 'vitest';

vi.mock('../camera/frame-source', async (original) => ({
  ...(await original<typeof FrameSourceModule>()),
  captureSourceFrame: vi.fn(),
}));
vi.mock('../camera/png-encode', () => ({ rgbaToPngDataUrl: () => 'data:image/png;base64,AAA' }));
vi.mock('./image-loader', async (original) => ({
  ...(await original<typeof ImageLoaderModule>()),
  dataUrlToFile: vi.fn(async () => new File(['fixture'], 'camera.png')),
}));
vi.mock('./use-trace-preview', () => ({ useTracePreview: () => ({ kind: 'tracing' }) }));
vi.mock('./trace-commit-result', () => ({ resolveTraceCommitResult: vi.fn() }));
vi.mock('../raster/vector-to-bitmap', () => ({ buildBitmapFromVectors: vi.fn() }));

import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { RgbaImage } from '../../core/camera';
import { TraceFromCameraButton } from '../camera/TraceFromCameraButton';
import { cameraCaptureBindingForFrame, captureSourceFrame } from '../camera/frame-source';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useCameraStore } from '../state/camera-store';
import { useToastStore } from '../state/toast-store';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { ImportImageDialog } from './ImportImageDialog';
import { resolveTraceCommitResult } from './trace-commit-result';
import type { TraceResult } from './use-trace-worker-client';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const frame: RgbaImage = {
  width: 256,
  height: 128,
  data: new Uint8ClampedArray(256 * 128 * 4).fill(255),
};
const camera = {
  kind: 'machine-jpeg' as const,
  frameUrl: '/generated.png',
  cameraUrl: 'http://localhost/generated.png',
  queryFingerprint: 'hmac-sha256:' + 'a'.repeat(64),
};
const result: TraceResult = {
  width: 256,
  height: 128,
  bounds: { minX: 32, minY: 24, maxX: 96, maxY: 80 },
  paths: [
    {
      // eslint-disable-next-line no-restricted-syntax -- Scene path color fixture, not UI chrome.
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 32, y: 24 },
            { x: 96, y: 24 },
            { x: 96, y: 80 },
            { x: 32, y: 80 },
          ],
        },
      ],
    },
  ],
};
const old: RasterImage = {
  kind: 'raster-image',
  id: 'old',
  source: 'existing.png',
  dataUrl: 'data:image/png;base64,OLD',
  pixelWidth: 8,
  pixelHeight: 8,
  bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
  transform: { ...IDENTITY_TRANSFORM, x: 51, y: 27 },
  // eslint-disable-next-line no-restricted-syntax -- Scene raster color fixture, not UI chrome.
  color: '#808080',
  operationIds: ['old-op'],
  dither: 'threshold',
  linesPerMm: 3,
};
const bitmap: RasterImage = {
  ...old,
  id: 'bitmap',
  source: 'converted',
  operationIds: [],
  bounds: { minX: 8, minY: 6, maxX: 24, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let host: HTMLDivElement;
let root: Root | undefined;
let pushToast: ReturnType<typeof vi.fn>;
const originalToast = useToastStore.getState().pushToast;

beforeEach(async () => {
  vi.mocked(captureSourceFrame).mockReset().mockResolvedValue(frame);
  vi.mocked(resolveTraceCommitResult).mockReset().mockResolvedValue(result);
  vi.mocked(buildBitmapFromVectors).mockReset().mockResolvedValue(bitmap);
  pushToast = vi.fn();
  useToastStore.setState({ pushToast });
  useUiStore.getState().closeImageDialog();
  const project = createProject();
  useStore.getState().setProject({
    ...project,
    device: {
      ...project.device,
      bedWidth: 64,
      bedHeight: 32,
      cameraAlignment: {
        homography: [0.25, 0, 0, 0, 0.25, 0, 0, 0, 1],
        frameWidth: 256,
        frameHeight: 128,
        basis: 'raw',
        alignedAt: 0,
        planeHeightMm: 0,
        capture: cameraCaptureBindingForFrame(camera, 256, 128),
      },
    },
    scene: {
      ...project.scene,
      objects: [old, { ...old, id: 'old-copy' }],
      layers: [
        {
          // eslint-disable-next-line no-restricted-syntax -- Scene operation color fixture.
          ...createLayer({ id: 'old-op', color: '#808080', mode: 'image' }),
          power: 37,
          linesPerMm: 3,
        },
        // eslint-disable-next-line no-restricted-syntax -- Scene operation color fixture.
        createLayer({ id: 'unused-existing', color: '#9333ea' }),
      ],
    },
  });
  useStore.setState({
    selectedObjectId: old.id,
    additionalSelectedIds: new Set(['old-copy']),
    dirty: false,
  });
  useCameraStore.setState({ sourceState: { kind: 'live', source: camera }, surfaceHeightMm: 0 });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(
        Fragment,
        null,
        createElement(TraceFromCameraButton),
        createElement(ImportImageDialog),
      ),
    );
  });
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host.remove();
  useUiStore.getState().closeImageDialog();
  useToastStore.setState({ pushToast: originalToast });
});
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error('Missing ' + label);
  await act(async () => {
    button.click();
  });
}
async function open() {
  await click('Trace from camera');
}
async function submit() {
  await act(async () => {
    element<HTMLFormElement>('form').requestSubmit();
  });
}
async function escape() {
  await act(async () => {
    element<HTMLFormElement>('form').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
}
async function options(output: 'vector' | 'raster', remove: boolean) {
  await act(async () => {
    const select = element<HTMLSelectElement>('select[aria-label="Trace output"]');
    select.value = output;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const toggle = element<HTMLInputElement>('.lf-trace-delete-source input');
    if (toggle.checked !== remove) toggle.click();
  });
}
function element<T extends Element>(selector: string): T {
  const found = host.querySelector<T>(selector);
  if (found === null) throw new Error('Missing control: ' + selector);
  return found;
}
function expectPristine(project: ReturnType<typeof useStore.getState>['project']) {
  const s = useStore.getState();
  expect(s.project).toBe(project);
  expect(s.undoStack).toHaveLength(0);
  expect(s.redoStack).toHaveLength(0);
  expect(s.dirty).toBe(false);
  expect(s.selectedObjectId).toBe('old');
  expect([...s.additionalSelectedIds]).toEqual(['old-copy']);
  expect(pushToast).not.toHaveBeenCalled();
}

export {
  frame,
  result,
  old,
  bitmap,
  deferred,
  host,
  root,
  pushToast,
  click,
  open,
  submit,
  escape,
  options,
  expectPristine,
};
export function clearRoot() {
  root = undefined;
}
