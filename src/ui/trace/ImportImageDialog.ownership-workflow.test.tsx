import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(async () => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]),
  })),
  dataUrlToFile: vi.fn(async () => new File(['image'], 'source.png', { type: 'image/png' })),
}));
vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(async () => ({
    paths: [{ color: '#000000', polylines: [] }],
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    width: 2,
    height: 2,
  })),
}));

import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { dataUrlToFile } from './image-loader';
import { ImportImageDialog } from './ImportImageDialog';
import { traceImageWithFallback } from './use-trace-worker-client';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('remounts file and busy state when a new Trace request replaces an in-flight request', async () => {
  const prior = useStore.getState();
  const sourceA = raster({ id: 'source-a', source: 'a.png' });
  const sourceB = raster({
    id: 'source-b',
    source: 'b.png',
    dataUrl: 'data:image/png;base64,BBB',
  });
  const traceExistingImage = vi.fn();
  let releaseSourceB: ((file: File) => void) | undefined;
  let releaseOldTrace:
    | ((result: Awaited<ReturnType<typeof traceImageWithFallback>>) => void)
    | undefined;
  const oldTrace = new Promise<Awaited<ReturnType<typeof traceImageWithFallback>>>((resolve) => {
    releaseOldTrace = resolve;
  });
  vi.mocked(dataUrlToFile)
    .mockResolvedValueOnce(new File(['a'], 'a.png', { type: 'image/png' }))
    .mockImplementationOnce(
      () =>
        new Promise<File>((resolve) => {
          releaseSourceB = resolve;
        }),
    );
  vi.mocked(traceImageWithFallback).mockImplementation(() => oldTrace);
  useStore.setState({
    project: { ...prior.project, scene: { ...prior.project.scene, objects: [sourceA] } },
    projectDocumentEpoch: prior.projectDocumentEpoch + 1,
    traceExistingImage,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  useUiStore.getState().openImageDialog(sourceA);
  const root = createRoot(host);
  await act(async () => root.render(createElement(ImportImageDialog)));
  try {
    await waitFor(() => expect(traceButton(host).disabled).toBe(false));
    await act(async () => traceButton(host).click());
    await waitFor(() => expect(traceButton(host).textContent).toContain('Tracing'));

    await act(async () => {
      useStore.setState({
        project: { ...prior.project, scene: { ...prior.project.scene, objects: [sourceB] } },
        projectDocumentEpoch: prior.projectDocumentEpoch + 2,
      });
      useUiStore.getState().openImageDialog(sourceB);
    });

    expect(host.textContent).toContain('b.png');
    expect(traceButton(host).textContent).not.toContain('Tracing');
    expect(traceButton(host).disabled).toBe(true);

    await act(async () => {
      releaseOldTrace?.({
        paths: [{ color: '#000000', polylines: [] }],
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        width: 2,
        height: 2,
      });
      releaseSourceB?.(new File(['b'], 'b.png', { type: 'image/png' }));
    });
    await waitFor(() => expect(traceButton(host).disabled).toBe(false));
    expect(traceExistingImage).not.toHaveBeenCalled();
    expect(host.textContent).toContain('b.png');
    expect(traceButton(host).textContent).not.toContain('Tracing');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useUiStore.setState({ imageDialog: null });
    useStore.setState(prior, true);
  }
});

function raster(over: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source-1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,AAA',
    pixelWidth: 100,
    pixelHeight: 80,
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    ...over,
  };
}

function traceButton(host: HTMLElement): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes('Trac'),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('Trace submit button missing');
  return button;
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
    }
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 10)));
  }
  throw lastError;
}
