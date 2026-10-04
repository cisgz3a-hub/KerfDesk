import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { useCameraStore } from '../state/camera-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { installFrameOnceProject } from '../laser/frame-once.test-support';
import { ensureFramedRunInvalidationSubscriptions } from '../laser/framed-run-invalidation';
import { preparedJobReview } from './prepared-job-review';
import { prepareRemoteJobReview } from './job-review-preparation';
import * as source from '../laser/start-job-source';
import { publishReviewedJobSnapshot } from '../laser/job-review/reviewed-job-snapshot';

beforeEach(() => {
  installFrameOnceProject();
  ensureFramedRunInvalidationSubscriptions();
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
  useJobReviewStore.getState().close();
  useFramePreparationStore.setState({ pending: false });
  const state = useStore.getState();
  const distant = createRectangle({
    id: 'distant',
    color: '#0000ff',
    spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
  });
  useStore.setState({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: [
          ...state.project.scene.objects,
          { ...distant, transform: { ...distant.transform, x: 100, y: 100 } },
        ],
        layers: [...state.project.scene.layers, createLayer({ id: 'blue', color: '#0000ff' })],
      },
    },
  });
});
afterEach(() => {
  useJobReviewStore.getState().close();
  vi.restoreAllMocks();
});

describe('prepared review scope facts', () => {
  it('reports selected-only output bounds while explicitly describing workspace totals', async () => {
    const all = await preparedJobReview('all');
    expect(all.summary?.bounds).toEqual({ xMm: 1, yMm: 280, widthMm: 109, heightMm: 119 });
    useStore.setState({ selectedObjectId: 'line-object' });
    useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
    const selected = await preparedJobReview('selected');
    expect(selected).toMatchObject({
      status: 'ready',
      summary: {
        artworkCount: 2,
        operationCount: 2,
        bounds: { xMm: 1, yMm: 391, widthMm: 8, heightMm: 8 },
      },
    });
    expect(selected.message).toContain('counts are workspace totals');
    expect(selected.summary?.estimatedSeconds).toBeLessThan(all.summary?.estimatedSeconds ?? 0);
  });
  it('excludes an output-disabled operation from actual prepared bounds and time', async () => {
    const all = await preparedJobReview('all');
    useStore.getState().setLayerParam('blue', { output: false });
    const disabled = await preparedJobReview('disabled');
    expect(disabled).toMatchObject({
      status: 'ready',
      summary: {
        artworkCount: 2,
        operationCount: 2,
        bounds: { xMm: 1, yMm: 391, widthMm: 8, heightMm: 8 },
      },
    });
    expect(disabled.summary?.estimatedSeconds).toBeLessThan(all.summary?.estimatedSeconds ?? 0);
  });
  it('keeps hidden but output-enabled artwork in the actual prepared program', async () => {
    const all = await preparedJobReview('all');
    useStore.getState().setLayerParam('blue', { visible: false });
    const hidden = await preparedJobReview('hidden');
    expect(hidden.status).toBe('ready');
    expect(hidden.summary?.bounds).toEqual(all.summary?.bounds);
    expect(hidden.summary?.estimatedSeconds).toEqual(all.summary?.estimatedSeconds);
  });
  it('does not invent a selected job when selected-only output has no selection', async () => {
    useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
    const missing = await preparedJobReview('missing-selection');
    expect(missing.status).toBe('unavailable');
    expect(missing.summary).toBeUndefined();
    expect(missing.warnings.map((warning) => warning.message).join(' ')).toContain(
      'no artwork is selected',
    );
  });
  it('does not stamp current camera facts onto an older displayed preparation', async () => {
    const initial = await prepareRemoteJobReview(useStore.getState(), useLaserStore.getState());
    if (!initial.ok) throw Error('Review fixture could not prepare.');
    useCameraStore.setState({ placementActive: true });
    useJobReviewStore.getState().open(initial.model);
    publishReviewedJobSnapshot(initial.bundle, initial.model);
    const prepare = vi.spyOn(source, 'prepareCurrentStartJob');
    await preparedJobReview('camera-after-compile');
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
