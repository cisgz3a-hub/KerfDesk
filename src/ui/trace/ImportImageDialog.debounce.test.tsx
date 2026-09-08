import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TraceResult } from './use-trace-worker-client';

const requests = vi.hoisted(
  (): Array<{ resolve: (result: TraceResult) => void; reject: (error: Error) => void }> => [],
);
vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(),
  dataUrlToFile: vi.fn(async () => new File(['fixture'], 'fixture.png')),
}));
vi.mock('./region-enhance-trace', () => ({
  traceImageWithBoundaryMode: vi.fn(() => {
    requests.at(-1)?.reject(new TraceRequestSupersededError());
    return new Promise<TraceResult>((resolve, reject) => requests.push({ resolve, reject }));
  }),
}));
vi.mock('../raster/vector-to-bitmap', () => ({ buildBitmapFromVectors: vi.fn() }));

import { loadImageAsRawData } from './image-loader';
import { TraceRequestSupersededError } from './use-trace-worker-client';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useToastStore } from '../state/toast-store';
import {
  chooseSettlementOutput,
  emptySettlement,
  mountSettlementDialog,
  settlementImage,
  settlementReady,
  settlementResult,
  settlementSnapshot,
  settlementSource,
  submitSettlement,
} from './trace-settlement.test-support';

let mounted: Awaited<ReturnType<typeof mountSettlementDialog>> | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  requests.length = 0;
  vi.mocked(loadImageAsRawData).mockReset().mockResolvedValue(settlementImage);
  vi.mocked(buildBitmapFromVectors)
    .mockReset()
    .mockResolvedValue({ ...settlementSource, id: 'bitmap-result' });
});
afterEach(async () => {
  await mounted?.close();
  mounted = undefined;
  vi.useRealTimers();
});

async function detection(host: HTMLElement, value: 'manual' | 'preset') {
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Trace detection"]');
  expect(select).not.toBeNull();
  await act(async () => {
    select!.value = value;
    select!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function pendingSubmit(
  camera = false,
  output: 'vector' | 'raster' = 'vector',
  remove = false,
) {
  mounted = await mountSettlementDialog(camera);
  await chooseSettlementOutput(mounted.host, output, remove);
  await detection(mounted.host, 'manual');
  expect(requests).toHaveLength(1);
  const before = settlementSnapshot();
  await submitSettlement(mounted.host);
  expect(requests).toHaveLength(2);
  return { host: mounted.host, before, submitted: requests[1]! };
}

it.each([
  { camera: false, output: 'vector' as const, remove: false },
  { camera: false, output: 'raster' as const, remove: true },
  { camera: true, output: 'vector' as const, remove: false },
  { camera: true, output: 'raster' as const, remove: true },
])('fulfils pending Submit: camera=$camera output=$output remove=$remove', async (mode) => {
  const { before, submitted } = await pendingSubmit(mode.camera, mode.output, mode.remove);
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(requests).toHaveLength(2);
  await act(async () => submitted.resolve(settlementResult));
  expect(useUiStore.getState().imageDialog).toBeNull();
  const state = useStore.getState();
  expect(state.project.scene.objects).toHaveLength(mode.remove ? 1 : 2);
  expect(state.project.scene.objects.some((object) => object.id === settlementSource.id)).toBe(
    !mode.remove,
  );
  expect(state.undoStack).toHaveLength(1);
  state.undo();
  expect(useStore.getState().project.scene).toEqual(before.scene);
});

it('preserves the after-dispatch control', async () => {
  mounted = await mountSettlementDialog();
  await detection(mounted.host, 'manual');
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(requests).toHaveLength(2);
  await submitSettlement(mounted.host);
  expect(requests).toHaveLength(3);
  await act(async () => requests[2]!.resolve(settlementResult));
  expect(useUiStore.getState().imageDialog).toBeNull();
  expect(useStore.getState().undoStack).toHaveLength(1);
});

it('settles pending empty output visibly and reuses its prepared result', async () => {
  const { host, before, submitted } = await pendingSubmit();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(requests).toHaveLength(2);
  await act(async () => submitted.resolve(emptySettlement));
  expect(settlementSnapshot()).toEqual(before);
  expect(settlementReady(host)).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(useToastStore.getState().toasts.at(-1)?.message).toContain('produced no paths');
  await submitSettlement(host);
  expect(requests).toHaveLength(2);
  expect(useToastStore.getState().toasts.at(-1)?.message).toContain('produced no paths');
});

it('settles a pending failure and recovers through a new prepared preview', async () => {
  const { host, before, submitted } = await pendingSubmit();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(requests).toHaveLength(2);
  await act(async () => submitted.reject(new Error('controlled trace failure')));
  expect(settlementSnapshot()).toEqual(before);
  expect(host.textContent).toContain('controlled trace failure');
  expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Could not trace');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await detection(host, 'preset');
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => requests[2]!.resolve(settlementResult));
  expect(settlementReady(host)).toBe(true);
  await submitSettlement(host);
  expect(requests).toHaveLength(3);
  expect(useStore.getState().undoStack).toHaveLength(1);
});

it('allows a genuinely newer settings request to cancel Submit and own prepared reuse', async () => {
  const { host, before } = await pendingSubmit();
  await detection(host, 'preset');
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(requests).toHaveLength(3);
  expect(settlementSnapshot()).toEqual(before);
  expect(useToastStore.getState().toasts).toHaveLength(0);
  await act(async () => requests[2]!.resolve(settlementResult));
  expect(settlementReady(host)).toBe(true);
  await submitSettlement(host);
  expect(requests).toHaveLength(3);
  expect(useStore.getState().undoStack).toHaveLength(1);
});

it('cannot commit into a replaced source while its original debounce is pending', async () => {
  const { submitted } = await pendingSubmit();
  const project = useStore.getState().project;
  await act(async () =>
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: [{ ...settlementSource, dataUrl: 'data:image/png;base64,REPLACED' }],
        },
      },
    }),
  );
  const replacement = settlementSnapshot();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => submitted.resolve(settlementResult));
  expect(settlementSnapshot()).toEqual(replacement);
  expect(useToastStore.getState().toasts).toHaveLength(0);
});
