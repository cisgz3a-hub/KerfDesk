import { useStore } from '../state/store';
import { createRemoteControlAdapter } from '../remote-control/adapter';
import type {
  RemoteControlAdapter,
  RemoteControlOptions,
  RemoteCommandResult,
} from '../remote-control/types';
import { remoteAppStatus } from './safe-app-status';
import { preparedJobReview } from './prepared-job-review';
import {
  ARTWORK_SHARING_EVENT,
  ARTWORK_SHARING_KEY,
  artworkSharingEnabled,
} from './artwork-sharing';
import {
  isRemoteAccessStatus,
  remoteRequest,
  REMOTE_REVOKE_EVENT,
  clearRemoteSession,
  ownsRemoteSession,
  setRemoteSession,
  useRemoteAccessStore,
  getAgedRemoteAccessStatus,
  type RemoteAccessStatus,
} from './remote-access-store';
import { remoteDeliveryResult, releaseRemoteDelivery } from './renderer-delivery';
import { createRendererMachineAuthorities } from './renderer-machine-authority';
import type { MachineAuthority } from '../remote-control/machine-types';

type RequestEnvelope = {
  id: string;
  command: string;
  args: unknown;
  clientId: string;
  canWrite: boolean;
  canControl: boolean;
};
type Active = {
  id: string;
  clientId: string;
  canWrite: boolean;
  machineAuthority: MachineAuthority | null;
  sharesArtwork: boolean;
  controller: AbortController;
};
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
    typeof value.canControl === 'boolean' &&
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
  private readonly options: RemoteControlOptions;
  private readonly ui = useRemoteAccessStore.getState();
  private readonly authorities = createRendererMachineAuthorities(
    (owner) => this.owns(owner),
    getAgedRemoteAccessStatus,
  );
  private readonly observeAuthorities = useRemoteAccessStore.subscribe(() =>
    this.authorities.observe(),
  );
  constructor() {
    this.options = {
      canWrite: () => this.canWrite(),
      canEdit: () => useStore.getState().pendingUndo === null,
      getAppStatus: remoteAppStatus,
      canShareArtwork: () => !this.stopped && artworkSharingEnabled(),
      getReview: preparedJobReview,
      captureMachineAuthority: () => this.active?.machineAuthority ?? null,
      getRemoteCaller: () =>
        this.session === null || this.active === null
          ? null
          : { clientId: this.active.clientId, sessionId: this.session },
    };
    this.adapter = createRemoteControlAdapter(this.options);
    window.addEventListener(REMOTE_REVOKE_EVENT, this.revoke);
    window.addEventListener(ARTWORK_SHARING_EVENT, this.sharingChanged);
    window.addEventListener('storage', this.sharingStorageChanged);
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
    this.authorities.revoke(clientId);
    for (const request of this.requests.values())
      if (clientId === null || request.clientId === clientId) request.controller.abort();
  };
  private sharingChanged = (): void => {
    if (artworkSharingEnabled()) return;
    for (const request of this.requests.values())
      if (request.sharesArtwork) request.controller.abort();
  };
  private sharingStorageChanged = (event: StorageEvent): void => {
    if (event.key === ARTWORK_SHARING_KEY || event.key === null) this.sharingChanged();
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
  private async run(
    request: RequestEnvelope,
    owner: string,
    current: Active,
    priority = false,
  ): Promise<void> {
    if (this.stopped || (!priority && this.active !== null)) return;
    // Priority Abort has explicit invocation authority and cannot lend editing
    // permission or identity to an ordinary request awaiting another result.
    if (!priority) this.active = current;
    let result: RemoteCommandResult | undefined;
    let receipt: RemoteCommandResult | undefined;
    try {
      result = await this.adapter.execute(request.command, request.args, {
        signal: current.controller.signal,
        machineAuthority: current.machineAuthority,
        remoteCaller: { clientId: current.clientId, sessionId: owner },
      });
      if (this.owns(owner)) {
        receipt = this.machineDelivery(request.command, result);
        receipt = remoteDeliveryResult(
          request.command,
          receipt,
          current.controller.signal,
          this.adapter.getRevision(),
          this.options,
        );
        await remoteRequest('complete', { id: request.id, result: receipt }, owner);
      }
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
      releaseRemoteDelivery(request.command, result);
      releaseRemoteDelivery(request.command, receipt);
      if (this.active === current) this.active = null;
      if (this.requests.get(request.id) === current) this.requests.delete(request.id);
    }
  }
  private machineDelivery(command: string, result: RemoteCommandResult): RemoteCommandResult {
    return this.adapter.machineDelivery?.(command, result) ?? result;
  }
  private schedule(request: RequestEnvelope, owner: string): void {
    const current = {
      id: request.id,
      clientId: request.clientId,
      canWrite: request.canWrite,
      machineAuthority: this.authorities.capture(owner, request.clientId, request.canControl),
      sharesArtwork: request.command === 'get_workspace_preview' || request.command === 'get_text',
      controller: new AbortController(),
    };
    this.requests.set(request.id, current);
    if (request.command === 'abort_job') void this.run(request, owner, current, true);
    else this.work = this.work.then(() => this.run(request, owner, current));
  }
  private lostConnection(owner: string): void {
    if (!this.owns(owner)) return;
    for (const request of this.requests.values()) request.controller.abort();
    this.authorities.dispose();
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
    this.authorities.dispose();
    this.observeAuthorities();
    this.adapter.dispose();
    window.removeEventListener(REMOTE_REVOKE_EVENT, this.revoke);
    window.removeEventListener(ARTWORK_SHARING_EVENT, this.sharingChanged);
    window.removeEventListener('storage', this.sharingStorageChanged);
    if (this.session !== null)
      void remoteRequest('detach', {}, this.session).catch(() => undefined);
    clearRemoteSession(this.session);
  }
}
