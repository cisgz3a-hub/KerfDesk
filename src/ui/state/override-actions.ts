// override-actions — real-time feed/rapid/spindle override sends (ADR-103
// G3). GRBL processes these single bytes instantly without queueing, so —
// unlike every other command surface — they are legal DURING a streaming
// job; that is their whole purpose. The live percentages come back in the
// status report's `Ov:` field and are cached in `ovCache`.

import type { RealtimeOverrideByte } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

type WriteFn = (line: string) => Promise<void>;

export function overrideActions(
  write: WriteFn,
  hasOverrides: () => boolean,
): Pick<LaserState, 'sendRealtimeOverride'> {
  return {
    sendRealtimeOverride: async (byte: RealtimeOverrideByte) => {
      // Defense in depth: even if the override controls were somehow mounted,
      // never write a GRBL 0x90–0x9D byte to a firmware without realtime
      // overrides — it would land in the line buffer and corrupt the running
      // stream (CTL-01). The UI mount is gated on the same capability.
      if (!hasOverrides()) return;
      await write(byte);
    },
  };
}
