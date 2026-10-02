import { useStore } from '../state/store';
import { createRemoteControlAdapter } from '../remote-control/adapter';
import type { RemoteControlAdapter } from '../remote-control/types';
import { remoteAppStatus } from './safe-app-status';
import {
  isRemoteAccessStatus,
  remoteRequest,
  REMOTE_REVOKE_EVENT,
  clearRemoteSession,
  ownsRemoteSession,
  setRemoteSession,
  useRemoteAccessStore,
  type RemoteAccessStatus,
} from './remote-access-store';

type RequestEnvelope = {
  id: string;
  command: string;
  args: unknown;
  clientId: string;
  canWrite: boolean;
};
type Active = { id: string; clientId: string; canWrite: boolean; controller: AbortController };
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function validRequest(value: unknown): value is RequestEnvelope {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    value.id.length <= 128 &&
    typeof value.command === 'string' &&
    typeof value.clientId === 'string' &&
    value.clientId.length <= 128 &&
    typeof value.canWrite === 'boolean' &&
    object(value.args)
  );
}
function validPoll(value: unknown): value is {
  requests: RequestEnvelope[];
  cancelled: string[];
  status: RemoteAccessStatus;
} {
  if (!object(value) || !Array.isArray(value.requests) || !Array.isArray(value.cancelled))
    return false;
  return (
    value.requests.length <= 1 &&
    value.requests.every(validRequest) &&
    value.cancelled.length <= 64 &&
    value.cancelled.every((id) => typeof id === 'string' && id.length <= 128) &&
    isRemoteAccessStatus(value.status)
  );
}

/** Polling continues during async text work so cancellation can reach its commit fence. */
export class RemoteRendererSession {
  private stopped = false;
  private session: string | null = null;
  private active: Active | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private work: Promise<void> = Promise.resolve();
  private readonly requests = new Map<string, Active>();
  private readonly adapter: RemoteControlAdapter;
  private readonly ui = useRemoteAccessStore.getState();
  constructor() {
    this.adapter = createRemoteControlAdapter({
      canWrite: () => this.canWrite(),
      canEdit: () => useStore.getState().pendingUndo === null,
      getAppStatus: remoteAppStatus,
    });
    window.addEventListener(REMOTE_REVOKE_EVENT, this.revoke);
  }
  private canWrite(): boolean {
    if (this.stopped || this.active?.canWrite !== true) return false;
    const status = useRemoteAccessStore.getState().status;
    return (
      status?.enabled === true &&
      status.available &&
      status.connected &&
      status.clients.some(
        (client) => client.id === this.active?.clientId && client.scopes.includes('edit'),
      )
    );
  }
  private revoke = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    const clientId = object(detail) && typeof detail.clientId === 'string' ? detail.clientId : null;
    for (const request of this.requests.values())
      if (clientId === null || request.clientId === clientId) request.controller.abort();
  };
  private owns(owner: string): boolean {
    return !this.stopped && this.session === owner && ownsRemoteSession(owner);
  }
  async start(): Promise<void> {
    try {
      const value = await remoteRequest('attach', {}, null);
      if (!object(value) || typeof value.sessionId !== 'string')
        throw new Error('Invalid remote session.');
      if (this.stopped) {
        await remoteRequest('detach', {}, value.sessionId).catch(() => undefined);
        return;
      }
      this.session = value.sessionId;
      setRemoteSession(this.session);
      void this.poll();
    } catch {
      if (!this.stopped) this.ui.setMessage('Remote access could not attach to this workspace.');
    }
  }
  private async run(request: RequestEnvelope, owner: string, current: Active): Promise<void> {
    if (this.stopped || this.active !== null) return;
    this.active = current;
    try {
      const result = await this.adapter.execute(request.command, request.args, {
        signal: current.controller.signal,
      });
      if (this.owns(owner)) await remoteRequest('complete', { id: request.id, result }, owner);
    } catch {
      if (this.owns(owner))
        await remoteRequest(
          'complete',
          {
            id: request.id,
            result: { ok: false, error: { code: 'failed' } },
          },
          owner,
        ).catch(() => undefined);
    } finally {
      if (this.active === current) this.active = null;
      if (this.requests.get(request.id) === current) this.requests.delete(request.id);
    }
  }
  private schedule(request: RequestEnvelope, owner: string): void {
    const current = {
      id: request.id,
      clientId: request.clientId,
      canWrite: request.canWrite,
      controller: new AbortController(),
    };
    this.requests.set(request.id, current);
    this.work = this.work.then(() => this.run(request, owner, current));
  }
  private lostConnection(owner: string): void {
    if (!this.owns(owner)) return;
    for (const request of this.requests.values()) request.controller.abort();
    this.ui.disconnected(
      owner,
      'Remote access lost its workspace connection. Reopen the app to reconnect.',
    );
  }
  private async poll(): Promise<void> {
    const owner = this.session;
    if (this.stopped || owner === null) return;
    try {
      const value = await remoteRequest('poll', {}, owner);
      if (!this.owns(owner)) return;
      if (!validPoll(value)) throw new Error('Invalid remote response.');
      this.ui.publish(value.status, owner);
      for (const id of value.cancelled) this.requests.get(id)?.controller.abort();
      for (const request of value.requests) this.schedule(request, owner);
    } catch {
      this.lostConnection(owner);
      return;
    }
    if (!this.stopped)
      this.timer = setTimeout(() => {
        void this.poll();
      }, 350);
  }
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    for (const request of this.requests.values()) request.controller.abort();
    this.adapter.dispose();
    window.removeEventListener(REMOTE_REVOKE_EVENT, this.revoke);
    if (this.session !== null)
      void remoteRequest('detach', {}, this.session).catch(() => undefined);
    clearRemoteSession(this.session);
  }
}
