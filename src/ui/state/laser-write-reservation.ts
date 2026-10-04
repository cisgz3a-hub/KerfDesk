import type { SerialConnection } from '../../platform/types';
import type { SafeWriteRefs } from './laser-safe-write';
import type { LaserState } from './laser-store';
import type { LaserMotionOperationId } from './laser-motion-operation';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { TranscriptSource } from './laser-transcript';
import { reserveUntrackedAcks } from './laser-untracked-ack-ledger';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
function assertCurrentWriteEpoch(refs: SafeWriteRefs, expected: number): void {
  if ((refs.writeEpoch ?? 0) !== expected)
    throw new Error('Serial session changed before dispatch.');
}

type WriteReservation = {
  readonly writeEpoch: number;
  readonly ownedMotionOperationId: LaserMotionOperationId | undefined;
  readonly reservation: ReturnType<typeof reserveUntrackedAcks>;
};
export function reserveWrite(
  set: SetFn,
  get: GetFn,
  refs: SafeWriteRefs,
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
): WriteReservation {
  const owedAcks = owedTerminalAcks(line, source);
  const writeEpoch = refs.writeEpoch ?? 0;
  const ownedMotionOperationId = currentMotionOperationId(get, action);
  const reservation = reserveUntrackedAcks(refs, owedAcks, ownedMotionOperationId ?? null);
  // A same-tick terminal response must already have its exact FIFO owner.
  set((state) => ({
    pendingTransportWrites: (state.pendingTransportWrites ?? 0) + 1,
    ...(owedAcks > 0 ? { pendingUntrackedAcks: state.pendingUntrackedAcks + owedAcks } : {}),
    ...motionTransportWritePatch(state, action, 1, ownedMotionOperationId),
    ...(state.capabilities.overrides && containsRealtimeOverride(line) ? { ovCache: null } : {}),
  }));
  return { writeEpoch, ownedMotionOperationId, reservation };
}
export function assertDispatchWrite(
  set: SetFn,
  refs: SafeWriteRefs,
  conn: SerialConnection,
  action: LaserSafetyAction | undefined,
  binding: WriteReservation,
  assertBeforeWrite?: () => void,
): void {
  try {
    assertCurrentWriteEpoch(refs, binding.writeEpoch);
    if (refs.connection !== conn) throw new Error('Serial connection changed before dispatch.');
    assertBeforeWrite?.();
  } catch (error) {
    releaseUnsentWrite(set, refs, action, binding);
    throw error;
  }
}
function releaseUnsentWrite(
  set: SetFn,
  refs: SafeWriteRefs,
  action: LaserSafetyAction | undefined,
  binding: WriteReservation,
): void {
  // No byte was sent. Keep every replacement-session reservation unchanged.
  if ((refs.writeEpoch ?? 0) !== binding.writeEpoch) return;
  const remaining = binding.reservation?.remaining ?? 0;
  if (binding.reservation !== null) {
    const index = refs.untrackedAckReservations?.indexOf(binding.reservation) ?? -1;
    if (index >= 0) refs.untrackedAckReservations?.splice(index, 1);
  }
  set((state) => ({
    pendingTransportWrites: Math.max(0, (state.pendingTransportWrites ?? 0) - 1),
    pendingUntrackedAcks: Math.max(0, state.pendingUntrackedAcks - remaining),
    ...motionTransportWritePatch(state, action, -1, binding.ownedMotionOperationId),
  }));
}

function currentMotionOperationId(
  get: GetFn,
  action: LaserSafetyAction | undefined,
): LaserMotionOperationId | undefined {
  const operation = get().motionOperation;
  if (action === 'frame' && operation?.kind === 'frame') return operation.operationId;
  if (action === 'jog' && operation?.kind === 'jog') return operation.operationId;
  return undefined;
}

export function motionTransportWritePatch(
  state: LaserState,
  action: LaserSafetyAction | undefined,
  delta: 1 | -1,
  motionOperationId: LaserMotionOperationId | undefined,
): Partial<Pick<LaserState, 'motionOperation'>> {
  const operation = state.motionOperation;
  if (
    (action !== 'frame' && action !== 'jog') ||
    motionOperationId === undefined ||
    operation === null ||
    operation.kind !== action ||
    operation.operationId !== motionOperationId
  ) {
    return {};
  }
  return {
    motionOperation: {
      ...operation,
      pendingMotionTransportWrites: Math.max(
        0,
        (operation.pendingMotionTransportWrites ?? 0) + delta,
      ),
    },
  };
}

function owedTerminalAcks(line: string, source: TranscriptSource): number {
  if (source === 'job') return 0;
  let count = 0;
  for (const ch of line) if (ch === '\n') count += 1;
  return count;
}

// Ov is intermittent. An admitted override makes its previous observation
// stale before the adapter can deliver the command: keeping a cached 100%
// would let the next laser Start (or Fire) omit its reset. Do not predict the
// firmware's clamp or reset result. A fresh same-session Ov restores the
// observation, including a reply delivered before the write promise settles.
// No completion-side cache mutation can then erase that reply or a new session.
function containsRealtimeOverride(payload: string): boolean {
  for (let index = 0; index < payload.length; index += 1) {
    const byte = payload.charCodeAt(index);
    // GRBL feed/rapid 0x90–0x97 and spindle 0x99–0x9D; 0x98 is reserved.
    if ((byte >= 0x90 && byte <= 0x97) || (byte >= 0x99 && byte <= 0x9d)) return true;
  }
  return false;
}
