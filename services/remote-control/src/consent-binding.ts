import { z } from 'zod';
import { grantSchema, OAUTH_READ, OAUTH_EDIT } from './protocol.js';
import { digest, sameDigest } from './security.js';
import type { approvedSession } from './relay.js';

type ApprovedSession = NonNullable<Awaited<ReturnType<typeof approvedSession>>>;
// Match the pinned provider's consent transaction lifetime; its own handle can expire sooner.
const CONSENT_TTL_SECONDS = 10 * 60;
const bindingSchema = grantSchema.extend({
  sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  displayedScopes: z
    .array(z.enum([OAUTH_READ, OAUTH_EDIT, 'offline_access']))
    .min(1)
    .max(3),
  expiresAt: z.number().int().positive().safe(),
});
const bindingKey = async (handle: string): Promise<string> =>
  `kerfdesk:consent-binding:v1:${await digest(handle)}`;

/** The provider handle already binds the client, redirect, resource, PKCE and browser cookie. */
export async function saveConsentBinding(
  env: Env,
  handle: string,
  session: ApprovedSession,
  displayedScopes: readonly string[],
): Promise<void> {
  const value = bindingSchema.parse({
    deviceId: session.identity.deviceId,
    clientId: session.identity.clientId,
    leaseId: session.info.leaseId,
    sessionDigest: session.identity.digest,
    displayedScopes: [...new Set(displayedScopes)],
    expiresAt: Date.now() + CONSENT_TTL_SECONDS * 1000,
  });
  await env.OAUTH_KV.put(await bindingKey(handle), JSON.stringify(value), {
    expirationTtl: CONSENT_TTL_SECONDS,
  });
}

/** Only server-owned presentation data can authorize this form; cookie holders cannot rewrite it. */
export async function matchesConsentBinding(
  env: Env,
  handle: string,
  session: ApprovedSession,
  selectedScopes: readonly string[],
): Promise<boolean> {
  if (handle.length === 0 || handle.length > 128) return false;
  const saved = bindingSchema.safeParse(await env.OAUTH_KV.get(await bindingKey(handle), 'json'));
  if (!saved.success) return false;
  const value = saved.data;
  return (
    value.expiresAt > Date.now() &&
    value.deviceId === session.identity.deviceId &&
    value.clientId === session.identity.clientId &&
    value.leaseId === session.info.leaseId &&
    sameDigest(value.sessionDigest, session.identity.digest) &&
    selectedScopes.includes(OAUTH_READ) &&
    selectedScopes.length <= 3 &&
    new Set(selectedScopes).size === selectedScopes.length &&
    selectedScopes.every((scope) => value.displayedScopes.some((displayed) => displayed === scope))
  );
}

export async function clearConsentBinding(env: Env, handle: string): Promise<void> {
  await env.OAUTH_KV.delete(await bindingKey(handle));
}
