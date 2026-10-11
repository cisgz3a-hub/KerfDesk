import { uuid, type RemoteTransport } from './transport';
import { TERMINAL_STATES, type ControlOperation } from './types';

const HEARTBEAT_MS = 150;
type HeldJog = {
  transport: RemoteTransport;
  operationId: string | null;
  timer: ReturnType<typeof setInterval> | null;
};

/** Own a gesture before admission, including cancellation while its receipt is pending. */
export class HeldJogController {
  private hold: HeldJog | null = null;

  async start(
    transport: RemoteTransport,
    admit: () => Promise<ControlOperation | null>,
  ): Promise<void> {
    if (this.hold !== null || !transport.socketOpen()) return;
    const hold: HeldJog = { transport, operationId: null, timer: null };
    this.hold = hold;
    const operation = await admit();
    if (operation === null) {
      if (this.hold === hold) this.stop();
      return;
    }
    hold.operationId = operation.operationId;
    if (
      this.hold !== hold ||
      !transport.socketOpen() ||
      document.visibilityState !== 'visible' ||
      TERMINAL_STATES.has(operation.state)
    ) {
      if (this.hold === hold) this.stop();
      else this.releaseOperation(hold);
      return;
    }
    transport.heartbeat(operation.operationId);
    hold.timer = setInterval(() => transport.heartbeat(operation.operationId), HEARTBEAT_MS);
  }

  stop(): void {
    const hold = this.hold;
    if (hold === null) return;
    this.hold = null;
    if (hold.timer !== null) clearInterval(hold.timer);
    hold.transport.releaseHolds();
    this.releaseOperation(hold);
  }

  active(): boolean {
    return this.hold !== null;
  }

  private releaseOperation(hold: HeldJog): void {
    if (hold.operationId === null) return;
    // A late receipt must only stop its old operation, on its original transport.
    // A global release here could cancel a newer gesture.
    void hold.transport
      .call('jog_hold_stop', {
        requestId: uuid(),
        operationId: hold.operationId,
      })
      .catch(() => undefined);
  }
}
