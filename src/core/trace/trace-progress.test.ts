import { expect, it } from 'vitest';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import { reportingTraceRunner, type TracePhase } from './trace-progress';
import { runTraceSteps, type TraceSteps } from './trace-steps';

it.each(Object.keys(TRACE_PRESETS))(
  '%s reports actual phases without changing geometry',
  async (name) => {
    const image = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) };
    for (let y = 3; y < 13; y++)
      for (let x = 6; x < 10; x++) image.data.fill(0, (y * 16 + x) * 4, (y * 16 + x) * 4 + 3);
    const options = TRACE_PRESETS[name]!;
    const expected = await traceImageToColoredPaths(image, options);
    const phases: TracePhase[] = [];
    const actual = await traceImageToColoredPaths(image, options, runTraceSteps, (phase) =>
      phases.push(phase),
    );
    expect(actual).toEqual(expected);
    expect(phases).toEqual(['preparing', 'tracing', 'refining']);
  },
);

it('preserves native generator execution and reports no completed refinement after failure', async () => {
  const modes: boolean[] = [];
  const phases: TracePhase[] = [];
  function* steps(): TraceSteps<number> {
    for (let i = 0; i < 5; i++) modes.push(yield);
    return 42;
  }
  const result = await reportingTraceRunner(runTraceSteps, (phase) => phases.push(phase))(steps());
  expect(result).toBe(42);
  expect(modes).toEqual([false, false, false, false, false]);
  expect(phases).toEqual(['preparing', 'tracing', 'refining']);
  phases.length = 0;
  const failing = reportingTraceRunner(
    () => {
      throw new Error('failed');
    },
    (phase) => phases.push(phase),
  );
  await expect(failing(steps())).rejects.toThrow('failed');
  expect(phases).toEqual(['preparing', 'tracing']);
});
