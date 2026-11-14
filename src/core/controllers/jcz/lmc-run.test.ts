// Audit of the last 200 PRs (#1725): the wait for the board's Ready bit
// counted its passes while the operator had paused, so a pause longer than
// about 30 s aborted the job with "never reported Ready".
import { describe, expect, it } from 'vitest';
import type { LmcLink } from './lmc-link';
import { LMC_READY_POLLS, runLmcProgram, type LmcRunHooks } from './lmc-run';

function fakeLink(readyAfterReads: number) {
  let reads = 0;
  const link = {
    command: async () => new Uint8Array(8),
    sendList: async () => true,
    boardStatus: async () => {
      reads += 1;
      return { ready: reads > readyAfterReads };
    },
  };
  return { link: link as unknown as LmcLink, reads: () => reads };
}

function hooks(pausedPolls: number): LmcRunHooks {
  let polls = 0;
  return {
    cancelled: () => false,
    paused: () => {
      polls += 1;
      return polls <= pausedPolls;
    },
    onProgress: () => undefined,
    sleep: async () => undefined,
  };
}

describe('LMC list wait', () => {
  it('holds the next list through a pause longer than the Ready limit', async () => {
    const { link } = fakeLink(0);
    const result = await runLmcProgram(
      link,
      [new Uint8Array(3072)],
      'job',
      false,
      hooks(LMC_READY_POLLS + 500),
    );
    expect(result).toEqual({ ok: true, executing: true });
  });

  it('still gives up on a board that never reports Ready', async () => {
    const fake = fakeLink(Number.POSITIVE_INFINITY);
    const result = await runLmcProgram(fake.link, [new Uint8Array(3072)], 'job', false, hooks(0));
    expect(result).toMatchObject({ ok: false, failure: 'not-ready' });
    expect(fake.reads()).toBe(LMC_READY_POLLS);
  });
});
