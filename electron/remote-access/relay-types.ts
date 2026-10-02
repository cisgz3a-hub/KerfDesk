export const REMOTE_ORIGIN = 'https://kerfdesk-phone-control.cisgz3a.workers.dev';
export const REMOTE_PAIR_TTL_MS = 300_000;
export type RemoteScope = 'read' | 'edit';
export type RemoteClient = {
  readonly id: string;
  readonly label: string;
  readonly scopes: RemoteScope[];
  readonly createdAt: number;
};
export type PairingRequest = {
  readonly pairingId: string;
  readonly clientLabel: string;
  readonly requestedScopes: RemoteScope[];
  readonly expiresAt: number;
  readonly expiresInMs: number;
};
export type PairingOffer = {
  readonly code: string;
  readonly expiresAt: number;
  readonly expiresInMs: number;
};
export type RemoteAccessStatus = {
  readonly statusRevision: number;
  readonly available: boolean;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly deviceId: string | null;
  readonly controlUrl: string;
  readonly mcpUrl: string;
  readonly pairing: PairingOffer | null;
  readonly pairingPending: boolean;
  readonly requests: PairingRequest[];
  readonly clients: RemoteClient[];
  readonly error: string | null;
};
