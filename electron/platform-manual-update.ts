import {
  verifyPlatformDownload,
  type DownloadPlatform,
} from '../public/desktop-platform-download.mjs';
import { fetchManualUpdateNotes } from './manual-update-notes.js';
import {
  compareReleaseVersions,
  fetchPlatformCandidate,
  manualReleaseKeySet,
  type PlatformCandidate,
  type UpdateFetch,
} from './manual-update-manifest.js';
import { officialPlatformDownloadUrl } from './official-download-page.js';
import type { PublicKeys } from './licensing-verification.js';
import {
  heldReleaseState,
  type DesktopUpdates,
  type UpdateState,
  type UpdateStatus,
} from './update-status.js';

type Options = {
  readonly platform: DownloadPlatform;
  readonly currentVersion: string;
  readonly currentPublishedAt: number;
  readonly keys: PublicKeys;
  readonly fetch: UpdateFetch;
  readonly eligible: (envelope: string, version: string) => Promise<boolean>;
  /** Wording only: an ineligible release that waits for a licence confirmation (ADR-547 Amd 1). */
  readonly awaitsConfirmation?:
    | ((envelope: string, version: string) => Promise<boolean>)
    | undefined;
  /** Opens the exact verified download page in the browser. */
  readonly openDownloadPage: (url: string) => Promise<void>;
  readonly announce?: (version: string) => void;
  readonly now?: () => number;
};

/**
 * Update notices for the unsigned commercial build on macOS and Linux
 * (ADR-613). It verifies this system's signed document exactly as Windows
 * verifies its own, but its action opens the download page for the verified
 * version: KerfDesk never downloads or installs a Mac or Linux update itself.
 */
export function createPlatformManualUpdates(options: Options): DesktopUpdates {
  return new PlatformUpdateService(options);
}

class PlatformUpdateService implements DesktopUpdates {
  private value: UpdateStatus;
  private candidate: PlatformCandidate | null = null;
  private notes: {
    readonly candidate: PlatformCandidate;
    readonly highlights: readonly string[] | null;
  } | null = null;
  private running: Promise<void> = Promise.resolve();
  private busy = false;
  private readonly announced = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.value = {
      mode: 'manual',
      delivery: 'download-page',
      installOnQuit: false,
      state: 'idle',
      currentVersion: options.currentVersion,
      version: null,
      checkedAt: null,
    };
  }
  readonly status = (): UpdateStatus => this.value;
  readonly settled = (): Promise<void> => this.running;
  private set(state: UpdateState, version: string | null = this.value.version): void {
    const notes =
      version !== null &&
      this.notes?.candidate === this.candidate &&
      this.candidate?.release.version === version &&
      ['available', 'not-covered', 'licence-unconfirmed'].includes(state)
        ? this.notes
        : null;
    this.value = {
      mode: 'manual',
      delivery: 'download-page',
      installOnQuit: false,
      currentVersion: this.options.currentVersion,
      state,
      version,
      checkedAt: this.now(),
      ...(notes === null
        ? {}
        : notes.highlights === null
          ? { releaseNotesState: 'unavailable' }
          : { releaseNotesState: 'available', releaseNotes: notes.highlights }),
    };
  }
  private start(operation: () => Promise<void>): void {
    this.busy = true;
    this.running = operation()
      .catch(() => this.set('failed'))
      .finally(() => {
        this.busy = false;
      });
  }
  readonly check = (): UpdateStatus => {
    if (this.busy) return this.value;
    this.set('checking');
    this.start(() => this.find());
    return this.value;
  };
  private async find(): Promise<void> {
    const { platform, keys, fetch, currentVersion } = this.options;
    const next = await fetchPlatformCandidate(fetch, keys, platform, this.now());
    if (next === null) {
      this.handleMissingFeed();
      return;
    }
    if (
      this.candidate !== null &&
      (compareReleaseVersions(next.release.version, this.candidate.release.version) < 0 ||
        (next.release.version === this.candidate.release.version &&
          next.envelope !== this.candidate.envelope))
    )
      throw new Error('Platform update regressed or changed');
    if (compareReleaseVersions(next.release.version, currentVersion) <= 0) {
      this.set('up-to-date', null);
      return;
    }
    if (Date.parse(next.release.publishedAt) < this.options.currentPublishedAt)
      throw new Error('Backdated platform release');
    this.candidate = next;
    this.notes = {
      candidate: next,
      highlights: await fetchManualUpdateNotes(fetch, keys, next, this.now()),
    };
    if (!(await this.options.eligible(next.envelope, next.release.version))) {
      const { awaitsConfirmation } = this.options;
      const held = await heldReleaseState(awaitsConfirmation, next.envelope, next.release.version);
      this.set(held, next.release.version);
      return;
    }
    this.set('available', next.release.version);
    if (!this.announced.has(next.release.version)) {
      this.announced.add(next.release.version);
      try {
        this.options.announce?.(next.release.version);
      } catch {
        /* OS notifications are optional. */
      }
    }
  }
  private handleMissingFeed(): void {
    if (this.candidate !== null) throw new Error('Previously available platform feed is missing');
    this.set('up-to-date', null);
  }
  /** Opens the download page of the verified, still covered candidate. */
  readonly download = (): UpdateStatus => {
    if (this.busy || this.candidate === null || this.value.state !== 'available') return this.value;
    const candidate = this.candidate;
    this.start(async () => {
      const release = await verifyPlatformDownload(
        candidate.envelope,
        manualReleaseKeySet(this.options.keys),
        this.options.platform,
        this.now(),
      );
      if (
        JSON.stringify(release) !== JSON.stringify(candidate.release) ||
        !(await this.options.eligible(candidate.envelope, release.version))
      )
        throw new Error('Release no longer covered');
      await this.options.openDownloadPage(
        officialPlatformDownloadUrl(release.version, this.options.platform),
      );
      this.set('available', release.version);
    });
    return this.value;
  };
}
