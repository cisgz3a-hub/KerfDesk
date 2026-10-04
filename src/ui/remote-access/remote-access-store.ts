import { create } from 'zustand';

export type RemoteAccessStatus = {
  readonly statusRevision: number;
  readonly available: boolean;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly deviceId: string | null;
  readonly controlUrl: string;
  readonly mcpUrl: string;
  readonly pairing: {
    readonly code: string;
    readonly expiresAt: number;
    readonly expiresInMs: number;
  } | null;
  readonly pairingPending: boolean;
  readonly requests: readonly {
    readonly pairingId: string;
    readonly clientLabel: string;
    readonly requestedScopes: readonly ('read' | 'edit' | 'control')[];
    readonly expiresAt: number;
    readonly expiresInMs: number;
  }[];
  readonly clients: readonly {
    readonly id: string;
    readonly label: string;
    readonly scopes: readonly ('read' | 'edit' | 'control')[];
    readonly controlExpiresInMs?: number;
  }[];
  readonly error: string | null;
};
type RemoteState = {
  readonly status: RemoteAccessStatus | null;
  readonly busy: boolean;
  readonly message: string | null;
  readonly publish: (status: RemoteAccessStatus, owner?: string | null) => void;
  readonly disconnected: (owner: string, message: string) => void;
  readonly setMessage: (message: string | null) => void;
  readonly act: (action: string, args?: Readonly<Record<string, unknown>>) => Promise<void>;
};

let sessionId: string | null = null;
let statusRevision = 0;
let statusPublishedAt = 0;
let actionSequence = 0;
let activeAction: number | null = null;
export const REMOTE_REVOKE_EVENT = 'kerfdesk:remote-revoke';
export function setRemoteSession(value: string | null): void {
  if (sessionId !== value) {
    statusRevision = 0;
    statusPublishedAt = 0;
    activeAction = null;
    actionSequence += 1;
    useRemoteAccessStore.setState({ status: null, busy: false, message: null });
  }
  sessionId = value;
}
export function clearRemoteSession(owner: string | null): void {
  if (sessionId === owner) setRemoteSession(null);
}
export function ownsRemoteSession(owner: string): boolean {
  return sessionId === owner;
}

/** A stalled renderer poll must never extend a previously reported control grant. */
export function getAgedRemoteAccessStatus(): RemoteAccessStatus | null {
  const status = useRemoteAccessStore.getState().status;
  return status === null
    ? null
    : ageStatus(status, Math.max(0, Math.ceil(performance.now() - statusPublishedAt)));
}

export async function remoteRequest(
  action: string,
  args: Readonly<Record<string, unknown>> = {},
  owner: string | null = sessionId,
): Promise<unknown> {
  const startedAt = performance.now();
  const response = await fetch(`./api/remote/${action}`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-KerfDesk-Remote': '1' },
    body: JSON.stringify({ ...(owner === null ? {} : { sessionId: owner }), ...args }),
  });
  if (!response.ok) throw new Error('Remote access is unavailable.');
  const value: unknown = await response.json();
  const elapsed = Math.max(0, Math.ceil(performance.now() - startedAt));
  if (isRemoteAccessStatus(value)) return ageStatus(value, elapsed);
  if (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    isRemoteAccessStatus(value.status)
  )
    return { ...value, status: ageStatus(value.status, elapsed) };
  return value;
}

/** Route delays only shorten presentation; native and relay clocks keep their own authority. */
function ageStatus(status: RemoteAccessStatus, elapsed: number): RemoteAccessStatus {
  const pairing = status.pairing;
  return {
    ...status,
    pairing:
      pairing === null || pairing.expiresInMs <= elapsed
        ? null
        : { ...pairing, expiresInMs: pairing.expiresInMs - elapsed },
    requests: status.requests
      .filter((item) => item.expiresInMs > elapsed)
      .map((item) => ({ ...item, expiresInMs: item.expiresInMs - elapsed })),
    clients: status.clients.map((client) =>
      client.controlExpiresInMs === undefined
        ? client
        : { ...client, controlExpiresInMs: Math.max(0, client.controlExpiresInMs - elapsed) },
    ),
  };
}

export function isRemoteAccessStatus(value: unknown): value is RemoteAccessStatus {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<RemoteAccessStatus>;
  return validSnapshot(item) && validConnection(item) && validCollections(item);
}
function validSnapshot(item: Partial<RemoteAccessStatus>): boolean {
  return (
    Number.isSafeInteger(item.statusRevision) &&
    (item.statusRevision ?? 0) > 0 &&
    typeof item.pairingPending === 'boolean' &&
    validPairing(item.pairing)
  );
}
function validConnection(item: Partial<RemoteAccessStatus>): boolean {
  return (
    typeof item.available === 'boolean' &&
    typeof item.enabled === 'boolean' &&
    typeof item.connected === 'boolean' &&
    (item.deviceId === null || typeof item.deviceId === 'string') &&
    typeof item.controlUrl === 'string' &&
    typeof item.mcpUrl === 'string' &&
    (item.error === null || typeof item.error === 'string')
  );
}

type StoreSet = (value: Partial<RemoteState>) => void;
type PublishStatus = (
  status: RemoteAccessStatus,
  owner: string | null,
  action?: number | null,
) => void;
function ownsAction(owner: string, sequence: number): boolean {
  return owner === sessionId && activeAction === sequence;
}
function notifyRevocation(action: string, args: Readonly<Record<string, unknown>>): void {
  if (
    action === 'revoke' ||
    action === 'revoke-all' ||
    (action === 'configure' && args.enabled === false)
  )
    window.dispatchEvent(
      new CustomEvent(REMOTE_REVOKE_EVENT, { detail: action === 'revoke' ? args : null }),
    );
}
function pairPresentation(
  action: string,
  status: RemoteAccessStatus | null,
  pending: boolean,
): Partial<RemoteState> {
  if (action !== 'pair' || status === null) return {};
  return {
    status: pending
      ? { ...status, pairing: null, pairingPending: true, requests: [] }
      : { ...status, pairingPending: false },
  };
}
function remoteAction(
  set: StoreSet,
  get: () => RemoteState,
  publish: PublishStatus,
): RemoteState['act'] {
  return async (action, args = {}) => {
    const owner = sessionId;
    if (owner === null) {
      set({ message: 'Remote access could not attach to this workspace.' });
      return;
    }
    const sequence = ++actionSequence;
    activeAction = sequence;
    notifyRevocation(action, args);
    set({ busy: true, message: null, ...pairPresentation(action, get().status, true) });
    try {
      const value = await remoteRequest(action, args, owner);
      if (!isRemoteAccessStatus(value)) throw new Error('Invalid remote status.');
      if (ownsAction(owner, sequence)) publish(value, owner, sequence);
    } catch {
      if (ownsAction(owner, sequence))
        set({
          message: 'The change could not be completed. Check the connection and try again.',
          ...pairPresentation(action, get().status, false),
        });
    } finally {
      if (ownsAction(owner, sequence)) {
        activeAction = null;
        set({ busy: false });
      }
    }
  };
}
function validPairing(value: RemoteAccessStatus['pairing'] | undefined): boolean {
  return (
    value === null ||
    (typeof value === 'object' &&
      typeof value.code === 'string' &&
      Number.isSafeInteger(value.expiresAt) &&
      Number.isSafeInteger(value.expiresInMs) &&
      value.expiresInMs > 0 &&
      value.expiresInMs <= 300_000)
  );
}
function validCollections(item: Partial<RemoteAccessStatus>): boolean {
  return (
    Array.isArray(item.clients) &&
    item.clients.length <= 20 &&
    Array.isArray(item.requests) &&
    item.requests.length <= 8 &&
    item.clients.every(
      (client) => validScopes(client?.scopes) && validControlLifetime(client?.controlExpiresInMs),
    ) &&
    item.requests.every((request) => validScopes(request?.requestedScopes))
  );
}

function validControlLifetime(value: number | undefined): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 30 * 24 * 60 * 60 * 1000)
  );
}

function validScopes(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 3 &&
    value.includes('read') &&
    new Set(value).size === value.length &&
    value.every((scope) => scope === 'read' || scope === 'edit' || scope === 'control')
  );
}

export const useRemoteAccessStore = create<RemoteState>((set, get) => {
  const publish = (
    status: RemoteAccessStatus,
    owner: string | null,
    action: number | null = null,
  ): void => {
    if (
      owner === null ||
      owner !== sessionId ||
      status.statusRevision <= statusRevision ||
      (activeAction !== null && action !== activeAction)
    )
      return;
    statusRevision = status.statusRevision;
    statusPublishedAt = performance.now();
    set({ status });
  };
  return {
    status: null,
    busy: false,
    message: null,
    publish: (status, owner = sessionId) => publish(status, owner),
    disconnected: (owner, message) => {
      if (owner !== sessionId) return;
      activeAction = null;
      actionSequence += 1;
      const status = get().status;
      set({
        busy: false,
        message,
        ...(status === null
          ? {}
          : {
              status: {
                ...status,
                connected: false,
                clients: [],
                requests: [],
                pairing: null,
                pairingPending: false,
              },
            }),
      });
    },
    setMessage: (message) => set({ message }),
    act: remoteAction(set, get, publish),
  };
});
