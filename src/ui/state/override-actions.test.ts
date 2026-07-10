import { describe, expect, it, vi } from 'vitest';
import type { RealtimeOverrideByte } from '../../core/controllers/grbl';
import { overrideActions } from './override-actions';

// RT_FEED_OV_RESET — a GRBL 1.1 extended realtime override byte (feed 100%).
const OVERRIDE_BYTE: RealtimeOverrideByte = '\x90';

describe('overrideActions', () => {
  it('sends the override byte when the controller declares realtime overrides', async () => {
    const write = vi.fn(async (_line: string) => undefined);
    await overrideActions(write, () => true).sendRealtimeOverride(OVERRIDE_BYTE);
    expect(write).toHaveBeenCalledWith(OVERRIDE_BYTE);
  });

  it('drops the byte when the controller has no realtime overrides (CTL-01)', async () => {
    // A 0x90–0x9D byte written to Marlin/Smoothieware/Ruida would corrupt the
    // running line buffer — the send path must refuse it, not just the UI.
    const write = vi.fn(async (_line: string) => undefined);
    await overrideActions(write, () => false).sendRealtimeOverride(OVERRIDE_BYTE);
    expect(write).not.toHaveBeenCalled();
  });
});
