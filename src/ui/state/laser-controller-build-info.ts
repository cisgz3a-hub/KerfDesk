import type { ControllerDriver } from '../../core/controllers';
import {
  parseBuildInfoResponses,
  type GrblBuildInfo,
} from '../../core/controllers/grbl/build-info';
import {
  startControllerCommand,
  type ControllerCommandKind,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { SessionObservationStamp } from './laser-controller-observation';
import type { TranscriptSource } from './laser-transcript';

const MAX_BUILD_INFO_LINES = 8;
const MAX_BUILD_INFO_LINE_LENGTH = 512;

export type ControllerBuildInfoState = {
  /** Strictly parsed stock-GRBL `$I` evidence. null means absent or unparsed. */
  readonly controllerBuildInfo: GrblBuildInfo | null;
  /** Bounded semantic `$I` lines retained for diagnostics/provenance. */
  readonly controllerBuildInfoRawLines: ReadonlyArray<string>;
  /** Session stamp for the completed read, including a malformed response. */
  readonly controllerBuildInfoObservation: SessionObservationStamp | null;
};

type BuildInfoWrite = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

export function emptyControllerBuildInfoState(): ControllerBuildInfoState {
  return {
    controllerBuildInfo: null,
    controllerBuildInfoRawLines: [],
    controllerBuildInfoObservation: null,
  };
}

export function observedControllerBuildInfoState(
  responses: ReadonlyArray<string>,
  sessionEpoch: number,
  observedAt: number,
): ControllerBuildInfoState {
  const rawLines = responses
    .slice(0, MAX_BUILD_INFO_LINES)
    .map((line) => line.slice(0, MAX_BUILD_INFO_LINE_LENGTH));
  const parsed = parseBuildInfoResponses(rawLines);
  return {
    controllerBuildInfo: parsed.ok ? parsed.value : null,
    controllerBuildInfoRawLines: rawLines,
    controllerBuildInfoObservation: { sessionEpoch, observedAt },
  };
}

/** Best-effort, read-only stock-GRBL `$I` query. Callers decide whether a
 * failure belongs in the log; unsupported drivers expose a null query. */
export async function readControllerBuildInfo(args: {
  readonly driver: ControllerDriver;
  readonly refs: ControllerLifecycleRefs;
  readonly write: BuildInfoWrite;
  readonly commandKind: ControllerCommandKind;
  readonly sessionEpoch: number;
  readonly isCurrent: () => boolean;
  readonly action?: LaserSafetyAction;
  readonly source?: TranscriptSource;
}): Promise<ControllerBuildInfoState | null> {
  const query = args.driver.commands.buildInfoQuery;
  if (query === null) return null;
  const responses = await startControllerCommand(args.refs, args.write, {
    kind: args.commandKind,
    label: 'read controller build information',
    command: `${query}\n`,
    timeoutMs: 2_000,
    ...(args.action === undefined ? {} : { action: args.action }),
    ...(args.source === undefined ? {} : { source: args.source }),
  });
  if (!args.isCurrent()) return null;
  return observedControllerBuildInfoState(responses, args.sessionEpoch, Date.now());
}
