import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useToastStore } from '../state/toast-store';
import { ImportImageDialog } from './ImportImageDialog';
import type { TraceResult } from './use-trace-worker-client';

export const settlementImage = {
  width: 100,
  height: 50,
  data: new Uint8ClampedArray(100 * 50 * 4).fill(255),
};
export const settlementResult: TraceResult = {
  width: 100,
  height: 50,
  bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
  paths: [
    {
      // eslint-disable-next-line no-restricted-syntax -- Scene fixture colour.
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
          ],
        },
      ],
    },
  ],
};
export const emptySettlement: TraceResult = {
  ...settlementResult,
  paths: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
};
export const settlementSource: RasterImage = {
  kind: 'raster-image',
  id: 'source',
  source: 'fixture.png',
  dataUrl: 'data:image/png;base64,AAA',
  pixelWidth: 100,
  pixelHeight: 50,
  bounds: { minX: 7, minY: 9, maxX: 57, maxY: 34 },
  transform: { ...IDENTITY_TRANSFORM, x: 12, y: 14 },
  // eslint-disable-next-line no-restricted-syntax -- Scene fixture colour.
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 4,
  operationIds: ['image-op'],
};

export function settlementSnapshot() {
  const s = useStore.getState();
  return {
    scene: s.project.scene,
    undo: s.undoStack,
    redo: s.redoStack,
    selected: s.selectedObjectId,
    additional: s.additionalSelectedIds,
    dirty: s.dirty,
  };
}
export async function mountSettlementDialog(camera = false, retrace = false) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const target: TracedImage = {
    kind: 'traced-image',
    id: 'prior-trace',
    source: 'fixture.png',
    traceSourceId: 'source',
    traceMode: 'filled-contours',
    tracePixelWidth: 100,
    tracePixelHeight: 50,
    bounds: settlementResult.bounds,
    transform: IDENTITY_TRANSFORM,
    paths: settlementResult.paths,
  };
  const p = createProject();
  useStore.getState().setProject({
    ...p,
    scene: {
      objects: camera ? [] : retrace ? [settlementSource, target] : [settlementSource],
      layers: camera
        ? []
        : [
            // eslint-disable-next-line no-restricted-syntax -- Scene fixture colour.
            createLayer({ id: 'image-op', mode: 'image', color: '#808080' }),
          ],
    },
  });
  useStore.setState({
    undoStack: [],
    redoStack: [],
    selectedObjectId: camera ? null : 'source',
    additionalSelectedIds: new Set(),
    dirty: false,
  });
  useToastStore.setState({ toasts: [] });
  useUiStore.getState().openImageDialog(settlementSource, {
    ...(camera ? { sourceOrigin: 'camera-capture' as const } : {}),
    ...(retrace ? { replaceTraceId: 'prior-trace' } : {}),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () => root.render(createElement(ImportImageDialog)));
  return {
    host,
    root,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
      useUiStore.getState().closeImageDialog();
    },
  };
}
export async function submitSettlement(host: HTMLElement) {
  const form = host.querySelector('form');
  if (form === null) throw new Error('Trace form missing');
  await act(async () => form.requestSubmit());
}
export async function chooseSettlementOutput(
  host: HTMLElement,
  output: 'vector' | 'raster',
  remove: boolean,
) {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Trace output"]');
    if (select === null) throw new Error('Trace output missing');
    select.value = output;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (remove) {
      const toggle = host.querySelector<HTMLInputElement>(
        'input[title="Remove the source bitmap from the workspace after creating the traced output."]',
      );
      if (toggle === null) throw new Error('Delete source toggle missing');
      toggle.click();
    }
  });
}
export function settlementReady(host: HTMLElement) {
  return [...host.querySelectorAll('button')].some((b) => b.textContent === 'Show Points');
}
