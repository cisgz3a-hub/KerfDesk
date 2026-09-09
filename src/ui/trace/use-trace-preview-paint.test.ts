import { expect, it, vi } from 'vitest';
vi.mock('./region-enhance-trace', () => ({ traceImageWithBoundaryMode: vi.fn() }));
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { runTrace, type TracePreviewState } from './use-trace-preview';
import type { TraceResult } from './use-trace-worker-client';

const image: RawImageData = { width: 8, height: 8, data: new Uint8ClampedArray(256) };
const result: TraceResult = {
  width: 8,
  height: 8,
  bounds: { minX: 1, minY: 1, maxX: 7, maxY: 7 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 1, y: 1 },
            { x: 7, y: 1 },
            { x: 7, y: 7 },
            { x: 1, y: 7 },
          ],
        },
      ],
    },
  ],
};

it('uses each outstanding request paint intent and suppresses a superseded Centerline result', async () => {
  let complete!: (value: TraceResult) => void;
  vi.mocked(traceImageWithBoundaryMode).mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const states: TracePreviewState[] = [],
    oldOptions = TRACE_PRESETS.Centerline!;
  const file = new File(['fixture'], 'ring.png'),
    request = { file, options: oldOptions, boundary: null, boundaryMode: 'crop' as const };
  let current = true;
  const old = runTrace({
    img: image,
    options: oldOptions,
    request,
    isCurrent: () => current,
    setState: (s) => states.push(s),
  });
  complete(result);
  await old;
  const first = states[0];
  expect(first?.kind).toBe('ready');
  if (first?.kind !== 'ready') throw Error('Ready preview missing');
  expect(first.svg).toContain('fill="none" stroke="#000000"');
  expect(first.paths).toBe(result.paths);
  expect(first.preparedTrace?.request).toBe(request);
  expect(first.preparedTrace?.result).toBe(result);
  vi.mocked(traceImageWithBoundaryMode).mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const stale = runTrace({
    img: image,
    options: oldOptions,
    isCurrent: () => current,
    setState: (s) => states.push(s),
  });
  current = false;
  vi.mocked(traceImageWithBoundaryMode).mockResolvedValueOnce(result);
  await runTrace({
    img: image,
    options: TRACE_PRESETS.Sharp!,
    isCurrent: () => true,
    setState: (s) => states.push(s),
  });
  complete(result);
  await stale;
  expect(states).toHaveLength(2);
  const last = states[1];
  if (last?.kind !== 'ready') throw Error('Latest preview missing');
  expect(last.svg).toContain('fill-rule="evenodd" stroke="none"');
  expect(last.paths).toBe(result.paths);
});
