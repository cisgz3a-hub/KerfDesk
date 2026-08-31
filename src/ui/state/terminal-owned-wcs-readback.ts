import type { ControllerDriver } from '../../core/controllers';
import { requestActiveWcsReadback } from './active-wcs-readback';
import {
  startControllerCommand,
  type ControllerCommandKind,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type TerminalOwnedWcsRefs = ControllerLifecycleRefs & {
  readonly driver: ControllerDriver;
};

type WriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

export async function requestTerminalOwnedActiveWcsReadback(
  get: () => LaserState,
  refs: TerminalOwnedWcsRefs,
  write: WriteFn,
  expectedEpoch: number,
  commandKind: ControllerCommandKind,
): Promise<void> {
  await requestActiveWcsReadback(
    get,
    refs.driver,
    async (line) => {
      await startControllerCommand(refs, write, {
        kind: commandKind,
        label: 'read active work coordinates',
        command: line,
        source: 'system',
      });
    },
    expectedEpoch,
  );
}
