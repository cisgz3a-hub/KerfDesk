import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TraceResult } from './use-trace-worker-client';
const requests = vi.hoisted(
  (): Array<{ resolve: (r: TraceResult) => void; reject: (e: Error) => void }> => [],
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
import { TraceRequestSupersededError } from './use-trace-worker-client';
import { loadImageAsRawData } from './image-loader';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useToastStore } from '../state/toast-store';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { createProject } from '../../core/scene';
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
  vi.mocked(buildBitmapFromVectors).mockReset();
});
afterEach(async () => {
  await mounted?.close();
  mounted = undefined;
  vi.useRealTimers();
});

for (const camera of [false, true])
  for (const output of ['vector', 'raster'] as const)
    for (const remove of [false, true])
      for (const failure of [false, true])
        it(`settles early ${failure ? 'failed' : 'empty'} ${output}, camera=${camera}, delete=${remove} without scene/history changes`, async () => {
          mounted = await mountSettlementDialog(camera);
          const { host } = mounted;
          await chooseSettlementOutput(host, output, remove);
          const before = settlementSnapshot();
          expect(requests).toHaveLength(1);
          await submitSettlement(host);
          expect(requests).toHaveLength(2);
          expect(host.textContent).toContain('Tracing...');
          await act(async () =>
            failure
              ? requests[1]!.reject(new Error('controlled trace failure'))
              : requests[1]!.resolve(emptySettlement),
          );
          expect(settlementSnapshot()).toEqual(before);
          expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            false,
          );
          expect(useUiStore.getState().imageDialog).not.toBeNull();
          expect(host.textContent).not.toContain('Tracing...');
          if (failure) {
            expect(host.textContent).toContain('Preview failed: controlled trace failure');
            expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
              'controlled trace failure',
            );
          } else {
            expect(settlementReady(host)).toBe(true);
            expect(useToastStore.getState().toasts.at(-1)?.message).toContain('produced no paths');
          }
        });

for (const empty of [false, true])
  it(`reuses matching prepared ${empty ? 'empty' : 'successful'} output with no duplicate decode/trace`, async () => {
    mounted = await mountSettlementDialog();
    const { host } = mounted;
    await act(async () => requests[0]!.resolve(empty ? emptySettlement : settlementResult));
    expect(settlementReady(host)).toBe(true);
    const before = settlementSnapshot();
    await submitSettlement(host);
    expect(requests).toHaveLength(1);
    expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
    if (empty) {
      expect(settlementReady(host)).toBe(true);
      expect(settlementSnapshot()).toEqual(before);
    } else {
      const s = useStore.getState();
      expect(useUiStore.getState().imageDialog).toBeNull();
      expect(s.undoStack).toHaveLength(1);
      const result = s.project.scene.objects.find((o) => o.kind === 'traced-image');
      expect(result?.paths).toEqual(settlementResult.paths);
      expect(result?.bounds).toEqual(settlementResult.bounds);
    }
  });

it('settles an empty retrace without replacing its existing target or deleting its source', async () => {
  mounted = await mountSettlementDialog(false, true);
  await chooseSettlementOutput(mounted.host, 'vector', true);
  const before = settlementSnapshot();
  await submitSettlement(mounted.host);
  await act(async () => requests[1]!.resolve(emptySettlement));
  expect(settlementSnapshot()).toEqual(before);
  expect(settlementReady(mounted.host)).toBe(true);
});

it('an early successful commit retains geometry and one grouped history entry', async () => {
  mounted = await mountSettlementDialog();
  await submitSettlement(mounted.host);
  await act(async () => requests[1]!.resolve(settlementResult));
  const s = useStore.getState();
  expect(useUiStore.getState().imageDialog).toBeNull();
  expect(s.undoStack).toHaveLength(1);
  const result = s.project.scene.objects.find((o) => o.kind === 'traced-image');
  expect(result?.paths).toEqual(settlementResult.paths);
  expect(result?.bounds).toEqual(settlementResult.bounds);
});

it('a failed commit decode settles its superseded preview and preserves the source', async () => {
  mounted = await mountSettlementDialog();
  const before = settlementSnapshot();
  vi.mocked(loadImageAsRawData).mockRejectedValueOnce(new Error('commit decode failure'));
  await submitSettlement(mounted.host);
  expect(requests).toHaveLength(1);
  expect(settlementSnapshot()).toEqual(before);
  expect(mounted.host.textContent).toContain('Preview failed: commit decode failure');
});

for (const replacement of ['close-reopen', 'replace-dialog', 'new-document'] as const)
  for (const failure of [false, true])
    it(`old ${failure ? 'error' : 'empty'} settlement cannot affect ${replacement}`, async () => {
      mounted = await mountSettlementDialog();
      await submitSettlement(mounted.host);
      const old = requests[1]!;
      await act(async () => {
        if (replacement === 'close-reopen') useUiStore.getState().closeImageDialog();
        if (replacement === 'new-document') useStore.getState().setProject(createProject());
        useUiStore
          .getState()
          .openImageDialog({ ...settlementSource, id: 'new-source', source: 'new.png' });
      });
      const before = settlementSnapshot(),
        dialog = useUiStore.getState().imageDialog,
        toasts = useToastStore.getState().toasts,
        preview = mounted.host.querySelector('[aria-label="Trace preview"]')?.textContent;
      await act(async () =>
        failure ? old.reject(new Error('old failure')) : old.resolve(emptySettlement),
      );
      expect(settlementSnapshot()).toEqual(before);
      expect(useUiStore.getState().imageDialog).toBe(dialog);
      expect(useToastStore.getState().toasts).toBe(toasts);
      expect(mounted.host.querySelector('[aria-label="Trace preview"]')?.textContent).toBe(preview);
      expect(mounted.host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
        false,
      );
    });

for (const camera of [false, true])
  it(`settled preview cannot revive a closed session during asynchronous bitmap output, camera=${camera}`, async () => {
    let finish!: (
      value: ReturnType<typeof buildBitmapFromVectors> extends Promise<infer T> ? T : never,
    ) => void;
    vi.mocked(buildBitmapFromVectors).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mounted = await mountSettlementDialog(camera);
    await chooseSettlementOutput(mounted.host, 'raster', true);
    await submitSettlement(mounted.host);
    await act(async () => requests[1]!.resolve(settlementResult));
    expect(buildBitmapFromVectors).toHaveBeenCalledOnce();
    expect(settlementReady(mounted.host)).toBe(true);
    await act(async () => {
      useUiStore.getState().closeImageDialog();
      useUiStore
        .getState()
        .openImageDialog({ ...settlementSource, id: 'new-source', source: 'new.png' });
    });
    const before = settlementSnapshot(),
      dialog = useUiStore.getState().imageDialog,
      toasts = useToastStore.getState().toasts;
    await act(async () => finish({ ...settlementSource, id: 'late-bitmap' }));
    expect(settlementSnapshot()).toEqual(before);
    expect(useUiStore.getState().imageDialog).toBe(dialog);
    expect(useToastStore.getState().toasts).toBe(toasts);
    expect(mounted.host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
  });
