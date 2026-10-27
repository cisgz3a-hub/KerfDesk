import { clockRolledBack } from './licensing-clock.js';
import type { LicensingConfig } from './licensing-config.js';
import type { LicenceRecord } from './licensing-store.js';
import { manualReleaseKeySet, verifyAnyManualDownload } from './manual-update-manifest.js';
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
    return this.signedVerdict(envelope, expectedVersion) === 'covered';
  }

  /**
   * A release held back only because this licence's last confirmation failed:
   * the saved rights cover it once a confirmation succeeds. It words the update
   * panel (ADR-547 Amendment 1) and never authorises an update (ADR-561 item 5).
   */
  awaitsConfirmation(envelope: unknown, expectedVersion: string): boolean {
    return this.signedVerdict(envelope, expectedVersion) === 'unconfirmed';
  }

  private signedVerdict(envelope: unknown, expectedVersion: string): ReleaseVerdict {
    if (this.config.channel !== 'commercial') return 'refused';
    return this.releaseVerdict(
      verifyLicenceRelease(envelope, this.config.releaseKeys, 'update-manifest'),
      expectedVersion,
    );
  }

  async readEligible(
    load: () => Promise<unknown>,
    envelope: unknown,
    expectedVersion: string,
  ): Promise<boolean> {
    if (this.config.channel !== 'commercial') return false;
    try {
      await load();
      return this.eligible(envelope, expectedVersion);
    } catch {
      return false;
    }
  }

  /** `awaitsConfirmation` after reloading the saved licence, as `readEligible` does. */
  readAwaits(load: Load, envelope: unknown, expectedVersion: string): Promise<boolean> {
    return afterLoad(load, () => this.awaitsConfirmation(envelope, expectedVersion));
  }

  async manualEligible(envelope: string, expectedVersion: string): Promise<boolean> {
    return (await this.manualVerdict(envelope, expectedVersion)) === 'covered';
  }

  /** `manualEligible` after reloading the saved licence. */
  readManualEligible(load: Load, envelope: string, expectedVersion: string): Promise<boolean> {
    return afterLoad(load, () => this.manualEligible(envelope, expectedVersion));
  }

  /** `awaitsConfirmation` for a manual download document, after reloading the saved licence. */
  readManualAwaits(load: Load, envelope: string, expectedVersion: string): Promise<boolean> {
    return afterLoad(
      load,
      async () => (await this.manualVerdict(envelope, expectedVersion)) === 'unconfirmed',
    );
  }

  private async manualVerdict(envelope: string, expectedVersion: string): Promise<ReleaseVerdict> {
    if (
      this.config.channel !== 'commercial' ||
      this.config.manualUpdates !== true ||
      this.config.sandbox === true
    )
      return 'refused';
    try {
      // The Windows document, or this release's macOS or Linux one (ADR-613).
      const release = await verifyAnyManualDownload(
        envelope,
        manualReleaseKeySet(this.config.releaseKeys),
        this.now() * 1000,
      );
      return this.releaseVerdict(
        {
          version: release.version,
          publishedAt: Math.floor(Date.parse(release.publishedAt) / 1000),
        },
        expectedVersion,
      );
    } catch {
      return 'refused';
    }
  }

  private releaseVerdict(
    release: ReturnType<typeof verifyLicenceRelease>,
    expectedVersion: string,
  ): ReleaseVerdict {
    if (this.config.channel !== 'commercial' || this.mutations !== 0 || this.value === null)
      return 'refused';
    const { saved, device } = this.value;
    if (release === null || release.version !== expectedVersion) return 'refused';
    if (saved.pendingDeactivation !== undefined) return 'refused';
    // A device with no licence runs the Free edition, which every release
    // includes, so it always takes the newest signed release (ADR-540).
    if (saved.credential === undefined) return 'covered';
    const claims = verifyEntitlement(
      saved.credential.entitlement,
      this.config.entitlementKeys,
      device,
    );
    if (claims === null) return 'refused';
    return claimsVerdict(claims, saved.lastSeenAt, this.now(), release, this.authenticationFailed);
  }
}

/**
 * `covered` releases may update. `unconfirmed` ones are covered by the saved
 * rights but wait for a licence confirmation to succeed; `refused` ones are not.
 */
type ReleaseVerdict = 'covered' | 'unconfirmed' | 'refused';
type Load = () => Promise<unknown>;

/** Reloads the saved licence, then answers. A licence that cannot be read refuses. */
async function afterLoad(load: Load, answer: () => boolean | Promise<boolean>): Promise<boolean> {
  try {
    await load();
    return await answer();
  } catch {
    return false;
  }
}

function claimsVerdict(
  claims: LicenceClaims,
  lastSeenAt: number,
  now: number,
  release: NonNullable<ReturnType<typeof verifyLicenceRelease>>,
  authenticationFailed: boolean,
): ReleaseVerdict {
  // An ended trial leaves a Free device too. A paid licence whose updates have
  // ended keeps its covered version, so its Pro tools stay unlocked.
  if (claims.accessExpiresAt !== null && Math.max(now, lastSeenAt) >= claims.accessExpiresAt)
    return 'covered';
  if (!validTime(claims, lastSeenAt, now) || !licenceCoversRelease(claims, release))
    return 'refused';
  // Failed licence authentication cannot authorize paid or still-active trial
  // updates (ADR-561 item 5). Free devices need no grant, including a verified
  // ended trial. The rights still cover the release, so it is only unconfirmed.
  return authenticationFailed ? 'unconfirmed' : 'covered';
}

function validTime(claims: LicenceClaims, lastSeenAt: number, now: number): boolean {
  // Paid and developer rights never expire, so the clock cannot block their updates.
  return (
    !clockRolledBack(claims, lastSeenAt, now) &&
    (claims.accessExpiresAt === null || now < claims.accessExpiresAt)
  );
}
