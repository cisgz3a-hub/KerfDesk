import { describe, expect, it } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { settledProgramAirAssistPatch } from './air-assist-command-state';

describe('air assist controller command evidence', () => {
  it('uses the final settled M7/M8/M9 command and ignores comment words', () => {
    const streamer = {
      ...createStreamer('M8\nG1 X10\nM9\nM5 ; M8\n(M7)\n'),
      status: 'done' as const,
    };
    expect(settledProgramAirAssistPatch(streamer)).toEqual({ airAssistOn: false });
    expect(settledProgramAirAssistPatch({ ...streamer, status: 'errored' })).toEqual({});
    expect(settledProgramAirAssistPatch({ ...createStreamer('G1X10m08'), status: 'done' })).toEqual(
      { airAssistOn: true },
    );
    expect(settledProgramAirAssistPatch({ ...createStreamer('M9\nM7'), status: 'done' })).toEqual({
      airAssistOn: true,
    });
    expect(settledProgramAirAssistPatch({ ...createStreamer('M7 M8 M9'), status: 'done' })).toEqual(
      { airAssistOn: false },
    );
  });

  it('does not turn separately enabled manual Air off for a job with no coolant command', () => {
    const streamer = { ...createStreamer('G21\nG90\nG1 X10 S100\nM5\n'), status: 'done' as const };
    expect(settledProgramAirAssistPatch(streamer)).toEqual({});
  });
});
