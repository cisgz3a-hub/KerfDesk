import { create } from 'zustand';

export type RemoteAccessStatus = {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly deviceId: string | null;
  readonly controlUrl: string;
  readonly mcpUrl: string;
  readonly pairing: { readonly code: string; readonly expiresAt: number } | null;
  readonly requests: readonly {
    readonly pairingId: string;
    readonly clientLabel: string;
    readonly requestedScopes: readonly ('read' | 'edit')[];
    readonly expiresAt: number;
  }[];
  readonly clients: readonly {
    readonly id: string;
    readonly label: string;
    readonly scopes: readonly ('read' | 'edit')[];
  }[];
  readonly error: string | null;
};
type RemoteState = {
  readonly status: RemoteAccessStatus | null;
  readonly busy: boolean;
  readonly message: string | null;
  readonly publish: (status: RemoteAccessStatus) => void;
  readonly setMessage: (message: string | null) => void;
  readonly act: (action: string, args?: Readonly<Record<string, unknown>>) => Promise<void>;
};

let sessionId: string | null = null;
export const REMOTE_REVOKE_EVENT = 'kerfdesk:remote-revoke';
export function setRemoteSession(value: string | null): void {
  sessionId = value;
}
export function clearRemoteSession(owner: string | null): void {
  if (sessionId === owner) sessionId = null;
}
export function ownsRemoteSession(owner: string): boolean {
  return sessionId === owner;
}

export async function remoteRequest(
  action: string,
  args: Readonly<Record<string, unknown>> = {},
  owner: string | null = sessionId,
): Promise<unknown> {
  const response = await fetch(`./api/remote/${action}`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-KerfDesk-Remote': '1' },
    body: JSON.stringify({ ...(owner === null ? {} : { sessionId: owner }), ...args }),
  });
  if (!response.ok) throw new Error('Remote access is unavailable.');
  return response.json() as Promise<unknown>;
}

export function isRemoteAccessStatus(value: unknown): value is RemoteAccessStatus {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<RemoteAccessStatus>;
  return (
    typeof item.available === 'boolean' &&
    typeof item.enabled === 'boolean' &&
    typeof item.connected === 'boolean' &&
    (item.deviceId === null || typeof item.deviceId === 'string') &&
    typeof item.controlUrl === 'string' &&
    typeof item.mcpUrl === 'string' &&
    validCollections(item) &&
    (item.error === null || typeof item.error === 'string')
  );
}
function validCollections(item: Partial<RemoteAccessStatus>): boolean {
  return (
    Array.isArray(item.clients) &&
    item.clients.length <= 20 &&
    Array.isArray(item.requests) &&
    item.requests.length <= 8
  );
}

export const useRemoteAccessStore = create<RemoteState>((set) => ({
  status: null,
  busy: false,
  message: null,
  publish: (status) => set({ status }),
  setMessage: (message) => set({ message }),
  act: async (action, args = {}) => {
    if (
      action === 'revoke' ||
      action === 'revoke-all' ||
      (action === 'configure' && args.enabled === false)
    )
      window.dispatchEvent(
        new CustomEvent(REMOTE_REVOKE_EVENT, { detail: action === 'revoke' ? args : null }),
      );
    set({ busy: true, message: null });
    try {
      const value = await remoteRequest(action, args);
      if (!isRemoteAccessStatus(value)) throw new Error('Invalid remote status.');
      set({ status: value });
    } catch {
      set({ message: 'The change could not be completed. Check the connection and try again.' });
    } finally {
      set({ busy: false });
    }
  },
}));
