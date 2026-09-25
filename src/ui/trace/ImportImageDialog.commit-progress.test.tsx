// ADR-401: a commit that traces a finer grid than the preview takes longer, so
// the dialog shows its phases over the preview until the commit settles it.
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TraceResult } from './use-trace-worker-client';
vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(),
  dataUrlToFile: vi.fn(async () => new File(['fixture'], 'fixture.png')),
}));
vi.mock('./region-enhance-trace', () => ({ traceImageWithBoundaryMode: vi.fn() }));
vi.mock('./trace-commit-result', () => ({ resolveTraceCommitResult: vi.fn() }));
import { loadImageAsRawData } from './image-loader';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { resolveTraceCommitResult } from './trace-commit-result';
import {
  mountSettlementDialog,
  settlementImage,
  settlementReady,
  settlementResult,
  submitSettlement,
} from './trace-settlement.test-support';

let mounted: Awaited<ReturnType<typeof mountSettlementDialog>> | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(loadImageAsRawData).mockReset().mockResolvedValue(settlementImage);
  vi.mocked(traceImageWithBoundaryMode).mockReset().mockResolvedValue(settlementResult);
  vi.mocked(resolveTraceCommitResult).mockReset();
});
afterEach(async () => {
  await mounted?.close();
  mounted = undefined;
  vi.useRealTimers();
});

it('shows the finer commit decode and trace phases over the preview', async () => {
  let finish!: (result: TraceResult) => void;
  let report!: (phase: 'decoding' | 'tracing') => void;
  vi.mocked(resolveTraceCommitResult).mockImplementation(
    (args) =>
      new Promise<TraceResult>((resolve) => {
        finish = resolve;
        report = (phase) => args.progress?.(phase);
      }),
  );
  mounted = await mountSettlementDialog();
  const { host } = mounted;
  await act(async () => vi.advanceTimersByTime(300));
  expect(settlementReady(host)).toBe(true);

  await submitSettlement(host);
  await act(async () => report('decoding'));
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe(
    'Preparing image for tracing',
  );
  await act(async () => report('tracing'));
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe(
    'Tracing image',
  );
  expect(host.textContent).toContain('Finding the lines and shapes in the image.');

  await act(async () => finish(settlementResult));
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
