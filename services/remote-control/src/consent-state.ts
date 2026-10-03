import { z } from 'zod';
import { grantSchema, OAUTH_READ, OAUTH_EDIT, type GrantProps } from './protocol.js';
import { sameDigest } from './security.js';

// Match the pinned provider's consent lifetime; its own transaction can expire sooner.
export const CONSENT_TTL_SECONDS = 10 * 60;
export const CONSENT_STORAGE_PREFIX = 'consent:v1:';
export const MAX_CONSENT_RECORDS = 64;
export const consentDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const consentBindingSchema = grantSchema.extend({
  sessionDigest: consentDigestSchema,
  displayedScopes: z
    .array(z.enum([OAUTH_READ, OAUTH_EDIT, 'offline_access']))
    .min(1)
    .max(3),
  expiresAt: z.number().int().positive().safe(),
});
export type ConsentBinding = z.output<typeof consentBindingSchema>;
export const consentRecordSchema = consentBindingSchema.extend({ consumed: z.boolean() });

/** The form's immutable presentation, rather than submitted data, sets its permission ceiling. */
export function matchesConsent(
  value: ConsentBinding,
  props: GrantProps,
  sessionDigest: string,
  selectedScopes: readonly string[],
): boolean {
  return (
    value.expiresAt > Date.now() &&
    value.deviceId === props.deviceId &&
    value.clientId === props.clientId &&
    value.leaseId === props.leaseId &&
    sameDigest(value.sessionDigest, sessionDigest) &&
    selectedScopes.includes(OAUTH_READ) &&
    selectedScopes.length <= 3 &&
    new Set(selectedScopes).size === selectedScopes.length &&
    selectedScopes.every((scope) => value.displayedScopes.some((displayed) => displayed === scope))
  );
}
