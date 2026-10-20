import { beforeEach, expect, it, vi } from 'vitest';
import type * as TraceWorker from './use-trace-worker-client';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(async () => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(16),
  })),
}));
vi.mock('./use-trace-worker-client', async (original) => ({
  ...(await original<typeof TraceWorker>()),
  traceImageWithFallback: vi.fn(async () => ({
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 2 },
              { x: 0, y: 2 },
            ],
          },
        ],
      },
    ],
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    width: 2,
    height: 2,
  })),
}));
vi.mock('../raster/vector-to-bitmap', () => ({
  buildBitmapFromVectors: vi.fn(async () => photo('worker-bitmap')),
}));

import { createImageMaskPixelTest } from '../../core/raster/image-mask';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type TextObject,
  type TracedImage,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { placeTextOnPath } from '../../core/text';
import { TRACE_PRESETS } from '../../core/trace';
import { prepareProjectForPersistence } from '../../io/project';
import { retraceOriginalAction } from '../commands/image-command-actions';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { commit } from './ImportImageDialog';

function photo(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,AAAAAA==',
    pixelWidth: 2,
    pixelHeight: 2,
    lumaBase64: 'AAAAAA==',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    operationIds: ['image'],
    dither: 'threshold',
    linesPerMm: 1,
  };
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  useUiStore.getState().closeImageDialog();
});

it.each(['vector', 'raster'] as const)(
  'keeps only valid dependencies when Re-trace Original outputs %s',
  async (output) => {
    const source = photo('source');
    const shape = createRectangle({
      id: 'prior',
      color: '#000000',
      spec: { widthMm: 5, heightMm: 10, cornerRadiusMm: 0 },
    });
    const prior: TracedImage = {
      kind: 'traced-image',
      id: 'prior',
      source: source.source,
      traceSourceId: source.id,
      bounds: shape.bounds,
      paths: shape.paths,
      transform: shape.transform,
    };
    const mask: RasterImage = { ...photo('masked'), imageMaskId: prior.id };
    const text: TextObject = {
      ...svgObj('label', ['#000000']),
      kind: 'text',
      color: '#000000',
      content: 'Label',
      fontKey: 'roboto',
      sizeMm: 1,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      pathText: { guideObjectId: prior.id, offsetMm: 0, reverse: false },
    };
    const groups = [{ id: 'pair', name: 'Retained pair', objectIds: [prior.id, text.id] }];
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [source, prior, mask, text],
          groups,
          layers: [
            createLayer({ id: 'image', color: '#808080', mode: 'image' }),
            createLayer({ id: 'line', color: '#000000' }),
          ],
        },
      },
    }));
    const before = useStore.getState().project;
    expect(prepareProjectForPersistence(before).kind).toBe('ok');
    const contains = createImageMaskPixelTest(mask, prior, 2, 2);
    expect(contains?.(0, 0)).toBe(true);
    expect(contains?.(1, 0)).toBe(false);
    const rendered = { bounds: text.bounds, paths: text.paths };
    expect(placeTextOnPath(rendered, prior, text.pathText!).kind).toBe('ok');
    retraceOriginalAction(before, prior, useUiStore.getState().openImageDialog, vi.fn())();
    const request = useUiStore.getState().imageDialog;
    expect(request?.replaceTraceId).toBe(prior.id);
    if (request === null) throw new Error('Re-trace dialog missing');
    await commit(
      {
        file: new File([''], source.source),
        seed: request.source,
        replaceTraceId: request.replaceTraceId!,
        options: TRACE_PRESETS['Line Art']!,
        traceOutput: output,
      },
      {
        traceExistingImage: useStore.getState().traceExistingImage,
        commitRasterizedTrace: useStore.getState().commitRasterizedTrace,
        claimOwner: () => ({ project: useStore.getState().project, source }),
        pushToast: vi.fn(),
        close: vi.fn(),
        setBusy: vi.fn(),
      },
    );
    const after = useStore.getState();
    const replacement = after.project.scene.objects.find((object) => object.id === prior.id)!;
    expect(replacement.kind).toBe(output === 'raster' ? 'raster-image' : 'traced-image');
    expect(after.project.scene.groups).toBe(groups);
    expect(prepareProjectForPersistence(after.project).kind).toBe('ok');
    const retainedMask = after.project.scene.objects.find((object) => object.id === mask.id);
    const retainedText = after.project.scene.objects.find((object) => object.id === text.id);
    if (output === 'raster') {
      // The output consumers cannot use the replacement raster as either vector dependency.
      expect(createImageMaskPixelTest(mask, replacement, 2, 2)).toBeNull();
      expect(placeTextOnPath(rendered, replacement, text.pathText!).kind).toBe('invalid-guide');
      expect(retainedMask).not.toHaveProperty('imageMaskId');
      expect(retainedText).not.toHaveProperty('pathText');
      expect(useToastStore.getState().toasts.some((toast) => toast.variant === 'warning')).toBe(
        true,
      );
    } else {
      expect(retainedMask).toBe(mask);
      expect(retainedText).toBe(text);
    }
    expect(retainedMask?.transform).toBe(mask.transform);
    expect(retainedText && 'paths' in retainedText ? retainedText.paths : undefined).toBe(
      text.paths,
    );
    expect(after.undoStack).toEqual([before]);
  },
);
