import { afterEach, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { marlinDriver } from '../../core/controllers/marlin/driver';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { TRANSCRIPT_MAX } from './laser-transcript';
import { LOG_MAX } from './laser-store-helpers';
import { canSendQueuedStatusQuery } from './laser-status-polling-policy';
import type { LiveRefs } from './laser-store';

afterEach(() => vi.restoreAllMocks());

it('bounds and publishes Marlin job history without queued status-poll replies', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
  const h = makeLineHandlerHarness();
  const refs = { ...h.refs, driver: marlinDriver, nextTranscriptId: 1 };
  const program = Array.from({ length: 3_000 }, (_, i) => `G1 X${i}`).join('\n');
  h.set({
    streamer: step(createStreamer(program, { streamingMode: 'ping-pong' })).state,
    activeControllerKind: 'marlin',
    capabilities: marlinDriver.capabilities,
  });
  for (let i = 0; i < 2_000; i += 1) {
    handleLine(h.set, h.get, refs, async () => undefined, 'ok');
    expect(canSendQueuedStatusQuery(h.get(), refs as LiveRefs, i, 4)).toBe(false);
  }
  expect(h.get().streamer?.completed).toBe(2_000);
  expect(refs.bufferedTranscript).toHaveLength(TRANSCRIPT_MAX);
  expect(refs.bufferedLog).toHaveLength(LOG_MAX);
  expect(h.get().transcript).toHaveLength(0);

  now.mockReturnValue(1_250);
  handleLine(h.set, h.get, refs, async () => undefined, 'ok');
  expect(h.get().streamer?.completed).toBe(2_001);
  expect(refs.bufferedTranscript).toHaveLength(0);
  expect(h.get().transcript).toHaveLength(TRANSCRIPT_MAX);
  expect(h.get().transcript[0]?.id).toBe(1_502);
  expect(h.get().transcript.at(-1)?.id).toBe(2_001);
  expect(h.get().log).toHaveLength(LOG_MAX);
});
