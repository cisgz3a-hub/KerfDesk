// override-actions — real-time feed/rapid/spindle override sends (ADR-103
// G3). GRBL processes these single bytes instantly without queueing, so —
// unlike every other command surface — they are legal DURING a streaming
// job; that is their whole purpose. The live percentages come back in the
// status report's `Ov:` field and are cached in `ovCache`.

import type { RealtimeOverrideByte } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

type WriteFn = (line: string) => Promise<void>;

export function overrideActions(write: WriteFn): Pick<LaserState, 'sendRealtimeOverride'> {
  return {
    sendRealtimeOverride: async (byte: RealtimeOverrideByte) => {
      await write(byte);
    },
  };
}
