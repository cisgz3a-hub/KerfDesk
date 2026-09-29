import type { LicensingConfig } from './licensing-config.js';
import type { LicenceRecord } from './licensing-store.js';
import {
  licenceCoversRelease,
  verifyEntitlement,
  verifyLicenceRelease,
  type LicenceClaims,
} from './licensing-verification.js';

/** Synchronous quit-time authority. It cannot grant or revoke a live session. */
export class LicensingUpdateCache {
  private value: { readonly saved: LicenceRecord; readonly device: string } | null = null;
  private mutations = 0;
  private authenticationFailed = false;

  constructor(
    private readonly config: LicensingConfig,
    private readonly now: () => number,
  ) {}
  update(saved: LicenceRecord, device: string): void {
    this.value = { saved, device };
  }
  invalidate(): void {
    this.value = null;
  }
  beginMutation(): void {
    this.mutations += 1;
    this.invalidate();
  }
  endMutation(): void {
    this.mutations -= 1;
  }
  failAuthentication(): void {
    this.authenticationFailed = true;
    this.invalidate();
  }
  acceptAuthentication(): void {
    this.authenticationFailed = false;
  }

  eligible(envelope: unknown, expectedVersion: string): boolean {
    if (
      this.config.channel !== 'commercial' ||
      this.mutations !== 0 ||
      this.authenticationFailed ||
      this.value === null
    )
      return false;
    const { saved, device } = this.value;
    if (saved.credential === undefined || saved.pendingDeactivation !== undefined) return false;
    const claims = verifyEntitlement(
      saved.credential.entitlement,
      this.config.entitlementKeys,
      device,
    );
    const release = verifyLicenceRelease(envelope, this.config.releaseKeys, 'update-manifest');
    if (claims === null || release === null || release.version !== expectedVersion) return false;
    return validTime(claims, saved.lastSeenAt, this.now()) && licenceCoversRelease(claims, release);
  }
}

function validTime(claims: LicenceClaims, lastSeenAt: number, now: number): boolean {
  return (
    now + 300 >= Math.max(lastSeenAt, claims.issuedAt) &&
    (claims.accessExpiresAt === null || now < claims.accessExpiresAt)
  );
}
