import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./image-loader', () => ({
  dataUrlToFile: vi.fn(async () => new File(['fixture'], 'fixture.png')),
}));
vi.mock('./use-trace-preview', () => ({ useTracePreview: () => ({ kind: 'tracing' }) }));
vi.mock('./trace-commit-result', () => ({ resolveTraceCommitResult: vi.fn() }));
vi.mock('../raster/vector-to-bitmap', () => ({ buildBitmapFromVectors: vi.fn() }));

import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { ImportImageDialog } from './ImportImageDialog';
import { resolveTraceCommitResult } from './trace-commit-result';
import type { TraceResult } from './use-trace-worker-client';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const result: TraceResult = {
  width: 100,
  height: 50,
  bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
  paths: [
    {
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
const source: RasterImage = {
  kind: 'raster-image',
  id: 'source',
  source: 'fixture.png',
  dataUrl: 'data:image/png;base64,AAA',
  pixelWidth: 100,
  pixelHeight: 50,
  bounds: { minX: 7, minY: 9, maxX: 57, maxY: 34 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 4,
  operationIds: ['image-op'],
};
const bitmap: RasterImage = {
  ...source,
  id: 'bitmap-output',
  dataUrl: 'data:image/png;base64,BBB',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let host: HTMLDivElement;
let root: Root | undefined;
let pushToast: ReturnType<typeof vi.fn>;
const originalPushToast = useToastStore.getState().pushToast;

beforeEach(async () => {
  vi.mocked(resolveTraceCommitResult).mockReset().mockResolvedValue(result);
  vi.mocked(buildBitmapFromVectors).mockReset().mockResolvedValue(bitmap);
  pushToast = vi.fn();
  useToastStore.setState({ pushToast });
  const project = createProject();
  useStore.getState().setProject({
    ...project,
    scene: {
      ...project.scene,
      objects: [source],
      layers: [createLayer({ id: 'image-op', mode: 'image', color: '#808080' })],
    },
  });
  useUiStore.getState().openImageDialog(source);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(ImportImageDialog));
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host.remove();
  useUiStore.getState().closeImageDialog();
  useToastStore.setState({ pushToast: originalPushToast });
});

function form(): HTMLFormElement {
  const element = host.querySelector('form');
  if (element === null) throw new Error('Trace form is missing');
  return element;
}

function submitButton(): HTMLButtonElement {
  const element = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (element === null) throw new Error('Trace button is missing');
  return element;
}

async function submit(): Promise<void> {
  await act(async () => {
    form().requestSubmit();
  });
}

async function escape(): Promise<void> {
  await act(async () => {
    form().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
}

async function reopen(): Promise<void> {
  await act(async () => {
    useUiStore.getState().openImageDialog(source);
  });
}

async function chooseOutput(output: 'vector' | 'raster', deleteSource: boolean): Promise<void> {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Trace output"]');
    if (select === null) throw new Error('Trace output is missing');
    select.value = output;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (deleteSource) {
      const toggle = host.querySelector<HTMLInputElement>(
        'input[title="Remove the source bitmap from the workspace after creating the traced output."]',
      );
      if (toggle === null) throw new Error('Delete Image After trace is missing');
      toggle.click();
    }
  });
}

function expectUnchanged(project: ReturnType<typeof useStore.getState>['project']): void {
  expect(useStore.getState().project).toBe(project);
  expect(useStore.getState().undoStack).toHaveLength(0);
  expect(pushToast).not.toHaveBeenCalled();
}

describe('Trace commit dialog and document lifetime', () => {
  it.each([
    ['vector', false],
    ['vector', true],
    ['raster', false],
    ['raster', true],
  ] as const)(
    'abandons pending %s output after Escape, delete source %s',
    async (output, remove) => {
      const pending = deferred<TraceResult>();
      vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(pending.promise);
      const before = useStore.getState().project;
      await chooseOutput(output, remove);
      await submit();
      expect(submitButton().disabled).toBe(true);
      await escape();
      await act(async () => {
        pending.resolve(result);
      });
      expectUnchanged(before);
      expect(buildBitmapFromVectors).not.toHaveBeenCalled();
    },
  );

  it.each(['success', 'empty', 'error'] as const)(
    'keeps a subsequent pending dialog independent of an abandoned %s',
    async (outcome) => {
      const old = deferred<TraceResult>();
      const next = deferred<TraceResult>();
      vi.mocked(resolveTraceCommitResult)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      const before = useStore.getState().project;
      await submit();
      await escape();
      await reopen();
      expect(submitButton().disabled).toBe(false);
      await submit();
      const currentDialog = useUiStore.getState().imageDialog;
      await act(async () => {
        if (outcome === 'error') old.reject(new Error('abandoned failure'));
        else old.resolve(outcome === 'empty' ? { ...result, paths: [] } : result);
      });
      expectUnchanged(before);
      expect(useUiStore.getState().imageDialog).toBe(currentDialog);
      expect(submitButton().disabled).toBe(true);
      await act(async () => {
        next.resolve(result);
      });
      expect(useStore.getState().project.scene.objects).toHaveLength(2);
      expect(pushToast).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it('resets the body when a new dialog replaces the same source without an intermediate render', async () => {
    const pending = deferred<TraceResult>();
    vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(pending.promise);
    const before = useStore.getState().project;
    await chooseOutput('raster', true);
    await submit();
    await reopen();
    expect(submitButton().disabled).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Trace output"]')?.value).toBe(
      'vector',
    );
    await act(async () => {
      pending.resolve(result);
    });
    expectUnchanged(before);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('abandons work on component unmount even if the dialog store is retained', async () => {
    const pending = deferred<TraceResult>();
    vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(pending.promise);
    const before = useStore.getState().project;
    await submit();
    await act(async () => {
      root?.unmount();
      root = undefined;
    });
    expect(useUiStore.getState().imageDialog).not.toBeNull();
    await act(async () => {
      pending.resolve(result);
    });
    expectUnchanged(before);
  });

  it.each(['trace', 'raster'] as const)(
    'abandons a replaced document with retained identities during %s',
    async (boundary) => {
      const tracing = deferred<TraceResult>();
      const raster = deferred<RasterImage>();
      if (boundary === 'trace')
        vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(tracing.promise);
      else vi.mocked(buildBitmapFromVectors).mockReturnValueOnce(raster.promise);
      await chooseOutput(boundary === 'raster' ? 'raster' : 'vector', true);
      await submit();
      if (boundary === 'raster') expect(buildBitmapFromVectors).toHaveBeenCalledTimes(1);
      const before = useStore.getState();
      await act(async () => {
        before.setProject(before.project);
      });
      expect(useStore.getState().projectDocumentEpoch).toBe(before.projectDocumentEpoch + 1);
      expect(useStore.getState().project.scene.objects[0]).toBe(source);
      const replacement = useStore.getState().project;
      await act(async () => {
        tracing.resolve(result);
        raster.resolve(bitmap);
      });
      expectUnchanged(replacement);
    },
  );

  it.each([false, true])(
    'abandons raster-build completion after Escape, delete source %s',
    async (remove) => {
      const pending = deferred<RasterImage>();
      vi.mocked(buildBitmapFromVectors).mockReturnValueOnce(pending.promise);
      const before = useStore.getState().project;
      await chooseOutput('raster', remove);
      await submit();
      expect(buildBitmapFromVectors).toHaveBeenCalledTimes(1);
      await escape();
      await reopen();
      const currentDialog = useUiStore.getState().imageDialog;
      await act(async () => {
        pending.resolve(bitmap);
      });
      expectUnchanged(before);
      expect(useUiStore.getState().imageDialog).toBe(currentDialog);
      expect(submitButton().disabled).toBe(false);
    },
  );

  it('suppresses a raster-build error after Escape', async () => {
    const pending = deferred<RasterImage>();
    vi.mocked(buildBitmapFromVectors).mockReturnValueOnce(pending.promise);
    await chooseOutput('raster', false);
    await submit();
    await escape();
    await act(async () => {
      pending.reject(new Error('abandoned bitmap failure'));
    });
    expect(pushToast).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'commits a valid early trace, delete source %s, as one undo/redo step',
    async (remove) => {
      const pending = deferred<TraceResult>();
      vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(pending.promise);
      const before = useStore.getState().project;
      await chooseOutput('vector', remove);
      await submit();
      await act(async () => {
        pending.resolve(result);
      });
      const committed = useStore.getState().project;
      expect(
        committed.scene.objects.filter((object) => object.kind === 'traced-image'),
      ).toHaveLength(1);
      expect(committed.scene.objects.some((object) => object.id === source.id)).toBe(!remove);
      expect(useStore.getState().undoStack).toHaveLength(1);
      await act(async () => {
        useStore.getState().undo();
      });
      expect(useStore.getState().project).toBe(before);
      await act(async () => {
        useStore.getState().redo();
      });
      expect(useStore.getState().project).toBe(committed);
      expect(pushToast).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves same-ID retrace and movement before Submit with grouped undo', async () => {
    const target: TracedImage = {
      kind: 'traced-image',
      id: 'target',
      source: source.source,
      traceSourceId: source.id,
      ...result,
      transform: IDENTITY_TRANSFORM,
    };
    const project = useStore.getState().project;
    await act(async () => {
      useStore
        .getState()
        .setProject({ ...project, scene: { ...project.scene, objects: [source, target] } });
      useUiStore.getState().openImageDialog(source, { replaceTraceId: target.id });
    });
    const pending = deferred<TraceResult>();
    vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(pending.promise);
    const moved = {
      ...source,
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 33,
        y: 44,
        scaleX: 1.6,
        scaleY: 0.8,
        rotationDeg: 31,
        mirrorX: true,
      },
    };
    const current = useStore.getState().project;
    await act(async () => {
      useStore.setState({
        project: { ...current, scene: { ...current.scene, objects: [moved, target] } },
      });
    });
    const beforeTrace = useStore.getState().project;
    await submit();
    await act(async () => {
      pending.resolve(result);
    });
    const committed = useStore.getState().project;
    expect(committed.scene.objects.map((object) => object.id)).toEqual(['source', 'target']);
    const traced = committed.scene.objects[1] as TracedImage;
    expect(traced.traceSourceId).toBe(source.id);
    for (const point of [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 13, y: 19 },
    ]) {
      const expected = applyTransform(
        { x: 7 + point.x * 0.5, y: 9 + point.y * 0.5 },
        moved.transform,
      );
      const actual = applyTransform(point, traced.transform);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
    }
    expect(useStore.getState().undoStack).toHaveLength(1);
    await act(async () => {
      useStore.getState().undo();
    });
    expect(useStore.getState().project).toBe(beforeTrace);
    await act(async () => {
      useStore.getState().redo();
    });
    expect(useStore.getState().project).toBe(committed);
  });
});
