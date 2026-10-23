// Per-launch secrets that tell KerfDesk's window its own camera bridge from
// any other program on the bridge's loopback port (rolling audit v2 04-P2-1,
// ADR-141 Amendment 2). The port is fixed and loopback ports are shared by
// every program and Windows account on the PC, so whatever listens there first
// would otherwise receive the RTSP camera logins. Main makes both keys at
// launch and gives them only to its own window, over app://app:
// - the proof key never leaves main and that window. Before the window sends a
//   camera address it asks /health to answer a fresh challenge, and only the
//   bridge can answer it with this HMAC;
// - the client token goes with each request that names a camera, so no other
//   program or page on this computer can use the bridge either.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** The request header that carries the client token. */
export const CAMERA_BRIDGE_TOKEN_HEADER = 'X-KerfDesk-Camera-Bridge-Token';
/** What the proof signs ahead of the challenge, so it cannot stand for anything else. */
export const CAMERA_BRIDGE_PROOF_LABEL = 'kerfdesk-camera-bridge-proof/1:';

export type CameraBridgeKeys = {
  /** 32 random bytes, base64url: the HMAC key the bridge proves itself with. */
  readonly proofKey: string;
  /** 32 random bytes, base64url: what a request must carry to name a camera. */
  readonly clientToken: string;
};

export function createCameraBridgeKeys(): CameraBridgeKeys {
  return {
    proofKey: randomBytes(32).toString('base64url'),
    clientToken: randomBytes(32).toString('base64url'),
  };
}

// The window sends 32 random bytes, base64url; anything else is not one of its challenges.
const CHALLENGE = /^[A-Za-z0-9_-]{22,128}$/;

/** The bridge's answer to `challenge`, or null for a malformed challenge. */
export function cameraBridgeProof(proofKey: string, challenge: string): string | null {
  if (!CHALLENGE.test(challenge)) return null;
  return createHmac('sha256', Buffer.from(proofKey, 'base64url'))
    .update(`${CAMERA_BRIDGE_PROOF_LABEL}${challenge}`)
    .digest('base64url');
}

/** True when the request header holds exactly `token`, compared in constant time. */
export function carriesClientToken(header: string | string[] | undefined, token: string): boolean {
  if (typeof header !== 'string') return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
