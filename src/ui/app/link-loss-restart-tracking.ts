// The first reconnect after a lost link decides whether the controller
// restarted (ADR-398 Amendment 3). Whatever a new connection shows first, a
// boot banner, an Alarm or a plain status report, is held for that
// connection. A saved lost-link run still waiting for the verdict takes it
// when the run was live as a link dropped, also if its record lands after the
// reconnect, or when its record was already saved as the connection began
// (after an app restart). A reboot later in the same connection does not
// count: by then the initial reconnect evidence has already been recorded.
//
// A banner proves a restart only where it cannot be a greeting (ADR-398
// Amendment 4). grblHAL greets every new network client and, on native USB,
// every port open, without resetting; and a board on Wi-Fi or Ethernet that
// did restart printed its boot banner before its network came up. There the
// first status decides: a running or held machine kept running, an Alarm
// stopped it, and anything else leaves the restart unknown.

import { awaitsLinkLossVerdict } from '../../core/recovery';
import type {
  LinkLossLink,
  LinkLossRestartEvidence,
  LinkLossRestartSign,
} from '../../core/recovery/link-loss-restart';
import type { GrblState } from '../../core/controllers/grbl';
import { controllerLink } from '../state/laser-safety-notice';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { recoveryRepository, type RecoveryRepository } from '../state/recovery';

type ReconnectFacts = Pick<
  LaserState,
  | 'connection'
  | 'serialPortInfo'
  | 'activeControllerKind'
  | 'detectedControllerKind'
  | 'alarmCode'
  | 'statusReport'
>;

// A controller that had restarted would be idle or alarmed: it has no job to
// run or hold. A door or a jog can follow a restart too.
const KEPT_RUNNING_STATES: ReadonlySet<GrblState> = new Set(['Run', 'Hold']);

/** What a connection has shown so far; null until the controller has spoken.
 * Connecting clears the banner's controller kind, the alarm and the status,
 * so each belongs to this connection, and only a startup banner sets the kind
 * (an owned M115 reply is consumed before it can). The port info is set with
 * the connected state, so the link is known from the first answer. */
export function linkLossRestartEvidence(state: ReconnectFacts): LinkLossRestartEvidence | null {
  if (state.connection.kind !== 'connected') return null;
  const link = controllerLink(state);
  const sign = reconnectSign(state, link);
  return sign === null ? null : { sign, link };
}

function reconnectSign(state: ReconnectFacts, link: LinkLossLink): LinkLossRestartSign | null {
  const banner = state.detectedControllerKind !== null;
  if (banner && !bannerMayGreet(state, link)) return 'boot-banner';
  if (state.alarmCode !== null || state.statusReport?.state === 'Alarm') return 'alarm';
  if (state.statusReport === null) return null;
  if (KEPT_RUNNING_STATES.has(state.statusReport.state)) return 'kept-running';
  // A restart can finish before USB reconnects, too. Missing its banner is
  // not evidence that the queued job survived; only Run or Hold proves that.
  return 'unknown';
}

/** Whether this connection's banner may be a greeting from a board that kept
 * running: grblHAL's on every link (a build reporting itself as "Grbl 1.1f"
 * runs a grblHAL profile), any banner over the network. */
function bannerMayGreet(state: ReconnectFacts, link: LinkLossLink): boolean {
  return (
    link === 'network' ||
    state.detectedControllerKind === 'grblhal' ||
    state.activeControllerKind === 'grblhal'
  );
}

/** `undefined` until the repository has loaded the record saved before the
 * connection began; `null` when there was none. */
type SavedBefore = string | null | undefined;

export function installLinkLossRestartTracking(
  repository: RecoveryRepository = recoveryRepository,
): () => void {
  // A connection already open at install has shown its first answer unseen.
  let watching = useLaserStore.getState().connection.kind !== 'connected';
  let connected = !watching;
  let evidence: LinkLossRestartEvidence | null = null;
  let savedBefore: SavedBefore = null;
  const droppedRuns = new Set<string>();
  let attempted: string | null = null;

  const savedRunId = (): SavedBefore => {
    const snapshot = repository.getSnapshot();
    return snapshot.loaded ? (snapshot.recoveryCapsule?.runId ?? null) : undefined;
  };
  const settle = (): void => {
    if (connected && savedBefore === undefined) savedBefore = savedRunId();
    const capsule = repository.getSnapshot().recoveryCapsule;
    // CNC pass recovery keeps its own planner reserve and reads no backlog.
    if (evidence === null || capsule?.artifact.machineKind !== 'laser') return;
    if (!awaitsLinkLossVerdict(capsule.interruption)) return;
    if (capsule.runId !== savedBefore && !droppedRuns.has(capsule.runId)) return;
    const attempt = `${capsule.runId}@${capsule.revision}`;
    if (attempted === attempt) return;
    attempted = attempt;
    void repository.settleLinkLossRestart(
      { runId: capsule.runId, revision: capsule.revision },
      evidence,
    );
  };
  const observe = (state: LaserState, prior?: LaserState): void => {
    if (state.connection.kind !== 'connected') {
      const runId = prior?.activeRunId ?? state.activeRunId;
      if (connected && runId !== null) droppedRuns.add(runId);
      connected = false;
      watching = true;
      evidence = null;
      return;
    }
    if (!connected) {
      connected = true;
      savedBefore = savedRunId();
    }
    if (watching && evidence === null) evidence = linkLossRestartEvidence(state);
    settle();
  };
  const unsubscribeLaser = useLaserStore.subscribe(observe);
  const unsubscribeRepository = repository.subscribe(settle);
  return () => {
    unsubscribeLaser();
    unsubscribeRepository();
  };
}
