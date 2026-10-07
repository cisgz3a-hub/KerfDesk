import { digest, RequestFailure } from './security.js';
import { device, type approvedSession } from './relay.js';
import { CONSENT_TTL_SECONDS, consentBindingSchema, matchesConsent } from './consent-state.js';

type ApprovedSession = NonNullable<Awaited<ReturnType<typeof approvedSession>>>;
const bindingKey = async (handle: string): Promise<string> =>
  `kerfdesk:consent-binding:v1:${await digest(handle)}`;

/** The provider handle already binds the client, redirect, resource, PKCE and browser cookie. */
export async function saveConsentBinding(
  env: Env,
  handle: string,
  session: ApprovedSession,
  displayedScopes: readonly string[],
): Promise<void> {
  const value = consentBindingSchema.parse({
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
  // KV remains the presentation check; only this strongly consistent record can be consumed once.
  if (!(await device(env, value.deviceId).saveConsent(await digest(handle), value)))
    throw new RequestFailure(503);
}

/** Only server-owned presentation data can authorize this form; cookie holders cannot rewrite it. */
export async function matchesConsentBinding(
  env: Env,
  handle: string,
  session: ApprovedSession,
  selectedScopes: readonly string[],
): Promise<boolean> {
  if (handle.length === 0 || handle.length > 128) return false;
  const saved = consentBindingSchema.safeParse(
    await env.OAUTH_KV.get(await bindingKey(handle), 'json'),
  );
  if (!saved.success) return false;
  return matchesConsent(
    saved.data,
    {
      deviceId: session.identity.deviceId,
      clientId: session.identity.clientId,
      leaseId: session.info.leaseId,
    },
    session.identity.digest,
    selectedScopes,
  );
}

/** Call only after the provider has validated the browser cookie and the user's decision. */
export async function consumeConsentBinding(
  env: Env,
  handle: string,
  session: ApprovedSession,
  selectedScopes: readonly string[],
): Promise<void> {
  if (
    !(await device(env, session.identity.deviceId).consumeConsent(
      await digest(handle),
      {
        deviceId: session.identity.deviceId,
        clientId: session.identity.clientId,
        leaseId: session.info.leaseId,
      },
      session.identity.digest,
      [...selectedScopes],
    ))
  )
    throw new RequestFailure(403);
  // A failed cleanup still cannot produce a code or redirect, and the durable marker is retained.
  await clearConsentBinding(env, handle);
}

async function clearConsentBinding(env: Env, handle: string): Promise<void> {
  await env.OAUTH_KV.delete(await bindingKey(handle));
}
