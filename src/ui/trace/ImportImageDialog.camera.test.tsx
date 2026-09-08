import './camera-trace.test-support';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { createProject } from '../../core/scene';
import { applyTransform, type RasterImage, type TracedImage } from '../../core/scene';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { resolveTraceCommitResult } from './trace-commit-result';
import { retraceOriginalAction } from '../commands/image-command-actions';
import type { TraceResult } from './use-trace-worker-client';
import {
  result,
  old,
  bitmap,
  deferred,
  pushToast,
  click,
  open,
  submit,
  escape,
  options,
  expectPristine,
} from './camera-trace.test-support';
describe('camera capture enters Trace as an atomic registered import', () => {
  it.each([
    ['vector', false],
    ['vector', true],
    ['raster', false],
    ['raster', true],
  ] as const)(
    'commits %s, delete source %s, with one undo step and independent placement',
    async (output, remove) => {
      const before = useStore.getState().project;
      await open();
      const seed = useUiStore.getState().imageDialog!.source;
      expect(seed.bounds).toEqual({ minX: 0, minY: 0, maxX: 64, maxY: 32 });
      expect(seed.pixelWidth).toBe(256);
      expect(seed.pixelHeight).toBe(128);
      expectPristine(before);
      await options(output, remove);
      await submit();
      const s = useStore.getState(),
        committed = s.project;
      expect(committed.scene.objects).toHaveLength(remove ? 3 : 4);
      expect(committed.scene.objects.slice(0, 2)).toEqual(before.scene.objects);
      expect(committed.scene.layers[0]).toBe(before.scene.layers[0]);
      expect(committed.scene.layers[1]).toBe(before.scene.layers[1]);
      const kept = committed.scene.objects.find((o) => o.id === seed.id);
      expect(kept).toEqual(
        remove
          ? undefined
          : expect.objectContaining({
              role: 'trace-source',
              bounds: seed.bounds,
              transform: seed.transform,
            }),
      );
      const added = committed.scene.objects.find((o) => o.id === s.selectedObjectId)!;
      expect('traceSourceId' in added && added.traceSourceId).toBe(seed.id);
      expect(s.additionalSelectedIds.size).toBe(0);
      expect(s.undoStack).toEqual([before]);
      expect(s.dirty).toBe(true);
      expect(useUiStore.getState().imageDialog).toBeNull();
      if (output === 'vector') {
        expect(added.kind).toBe('traced-image');
        const traced = added as TracedImage;
        expect(
          traced.paths[0]!.polylines[0]!.points.map((p) => applyTransform(p, traced.transform)),
        ).toEqual([
          { x: 8, y: 6 },
          { x: 24, y: 6 },
          { x: 24, y: 20 },
          { x: 8, y: 20 },
        ]);
      } else {
        expect(added.kind).toBe('raster-image');
        expect(buildBitmapFromVectors).toHaveBeenCalledWith(expect.any(Array), {
          dpi: 254,
          renderType: 'fill-all',
          brightnessPercent: 0,
        });
        const op = committed.scene.layers.find((l) => added.operationIds?.includes(l.id))!;
        expect(op.mode).toBe('image');
        expect(op.linesPerMm).toBe(10);
        expect(op.ditherAlgorithm).toBe('floyd-steinberg');
        expect((added as RasterImage).operationOverride?.negativeImage).toBe(false);
      }
      await act(async () => {
        s.undo();
      });
      expect(useStore.getState().project).toBe(before);
      await act(async () => {
        s.redo();
      });
      expect(useStore.getState().project).toBe(committed);
    },
  );
  it.each(['Cancel', 'Escape'])('leaves no document residue after %s', async (action) => {
    const before = useStore.getState().project;
    await open();
    if (action === 'Escape') await escape();
    else await click('Cancel');
    expectPristine(before);
    expect(useUiStore.getState().imageDialog).toBeNull();
  });
  it.each([
    ['vector', false],
    ['vector', true],
    ['raster', false],
    ['raster', true],
  ] as const)(
    'abandons early %s submission, delete %s, without touching a later dialog',
    async (output, remove) => {
      const pending = deferred<TraceResult>();
      vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(pending.promise);
      const before = useStore.getState().project;
      await open();
      await options(output, remove);
      await submit();
      await escape();
      await open();
      const next = useUiStore.getState().imageDialog;
      await act(async () => {
        pending.resolve(result);
      });
      expectPristine(before);
      expect(useUiStore.getState().imageDialog).toBe(next);
      expect(buildBitmapFromVectors).not.toHaveBeenCalled();
      await submit();
      expect(useStore.getState().project.scene.objects).toHaveLength(4);
    },
  );
  it.each([false, true])('abandons the bitmap-build await, delete %s', async (remove) => {
    const pending = deferred<RasterImage>();
    vi.mocked(buildBitmapFromVectors).mockReturnValueOnce(pending.promise);
    const before = useStore.getState().project;
    await open();
    await options('raster', remove);
    await submit();
    expect(buildBitmapFromVectors).toHaveBeenCalledTimes(1);
    expectPristine(before);
    await escape();
    await open();
    const next = useUiStore.getState().imageDialog;
    await act(async () => {
      pending.resolve(bitmap);
    });
    expectPristine(before);
    expect(useUiStore.getState().imageDialog).toBe(next);
  });
  it.each(['trace', 'raster'] as const)(
    'abandons a document replaced during %s',
    async (boundary) => {
      const trace = deferred<TraceResult>(),
        raster = deferred<RasterImage>();
      if (boundary === 'trace')
        vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(trace.promise);
      else vi.mocked(buildBitmapFromVectors).mockReturnValueOnce(raster.promise);
      await open();
      await options(boundary === 'raster' ? 'raster' : 'vector', true);
      await submit();
      const replacement = createProject();
      await act(async () => {
        useStore.getState().setProject(replacement);
      });
      await act(async () => {
        trace.resolve(result);
        raster.resolve(bitmap);
      });
      expect(useStore.getState().project).toBe(replacement);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(pushToast).not.toHaveBeenCalled();
    },
  );
  it('re-traces a retained camera source using the ordinary same-ID scene route', async () => {
    await open();
    await submit();
    const s = useStore.getState();
    const target = s.project.scene.objects.find((o) => o.id === s.selectedObjectId)!;
    await act(async () => {
      retraceOriginalAction(s.project, target, useUiStore.getState().openImageDialog, pushToast)();
    });
    expect(useUiStore.getState().imageDialog?.replaceTraceId).toBe(target.id);
    await submit();
    expect(useStore.getState().project.scene.objects.map((o) => o.id)).toEqual(
      s.project.scene.objects.map((o) => o.id),
    );
    expect(useStore.getState().undoStack).toHaveLength(2);
  });
  it('keeps camera dialog ownership when a document changes before submission', async () => {
    await open();
    const replacement = createProject();
    await act(async () => {
      useStore.getState().setProject(replacement);
    });
    await submit();
    expect(useStore.getState().project).toBe(replacement);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(resolveTraceCommitResult).not.toHaveBeenCalled();
  });
  it.each(['removed', 'changed'])(
    'still rejects an ordinary scene source that was %s',
    async (change) => {
      const pending = deferred<TraceResult>();
      vi.mocked(resolveTraceCommitResult).mockReturnValueOnce(pending.promise);
      await act(async () => {
        useUiStore.getState().openImageDialog(old);
      });
      await submit();
      const project = useStore.getState().project;
      await act(async () => {
        useStore.setState({
          project: {
            ...project,
            scene: {
              ...project.scene,
              objects: change === 'removed' ? [] : [{ ...old, dataUrl: 'changed' }],
            },
          },
        });
      });
      const before = useStore.getState().project;
      await act(async () => {
        pending.resolve(result);
      });
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(pushToast).not.toHaveBeenCalled();
    },
  );
});
