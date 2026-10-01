import { verifyManualDownload } from '../public/desktop-manual-download.mjs';
import { fetchManualUpdateNotes } from './manual-update-notes.js';
import {
  compareReleaseVersions,
  fetchManualCandidate,
  manualReleaseKeySet,
  type ManualCandidate,
  type UpdateFetch,
} from './manual-update-manifest.js';
import {
  discardStagedInstaller,
  downloadManualInstaller,
  pruneManualInstallerCache,
  verifyStagedInstaller,
  type StagedManualUpdate,
} from './manual-update-download.js';
import type { PublicKeys } from './licensing-verification.js';
import type { DesktopUpdates, UpdateState, UpdateStatus } from './update-status.js';

export type ManualUpdates = DesktopUpdates & {
  readonly prepareInstall: () => Promise<string | null>;
};
type Options = {
  readonly currentVersion: string;
  readonly currentPublishedAt: number;
  readonly userDataPath: string;
  readonly keys: PublicKeys;
  readonly fetch: UpdateFetch;
  readonly eligible: (envelope: string, version: string) => Promise<boolean>;
  readonly announce?: (version: string) => void;
  readonly now?: () => number;
};

export function createManualUpdates(options: Options): ManualUpdates {
  return new ManualUpdateService(options);
}

class ManualUpdateService implements ManualUpdates {
  private value: UpdateStatus;
  private candidate: ManualCandidate | null = null;
  private notes: {
    readonly candidate: ManualCandidate;
    readonly highlights: readonly string[] | null;
  } | null = null;
  private staged: StagedManualUpdate | null = null;
  private running: Promise<void> = Promise.resolve();
  private busy = false;
  private readonly announced = new Set<string>();
  private readonly now: () => number;
  private readonly initialized: Promise<void>;

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.initialized = pruneManualInstallerCache(options.userDataPath);
    this.value = {
      mode: 'manual',
      installOnQuit: false,
      state: 'idle',
      currentVersion: options.currentVersion,
      version: null,
      checkedAt: null,
    };
  }
  readonly status = (): UpdateStatus => this.value;
  readonly settled = (): Promise<void> => this.running;
  private set(
    state: UpdateState,
    version: string | null = this.value.version,
    armed = false,
  ): void {
    const notes =
      version !== null &&
      this.notes?.candidate === this.candidate &&
      this.candidate?.release.version === version &&
      !['idle', 'checking', 'up-to-date', 'unavailable'].includes(state)
        ? this.notes
        : null;
    this.value = {
      mode: 'manual',
      currentVersion: this.options.currentVersion,
      state,
      version,
      checkedAt: this.now(),
      installOnQuit: armed,
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
    if (this.busy || this.staged !== null) return this.value;
    this.set('checking');
    this.start(() => this.find());
    return this.value;
  };
  private async find(): Promise<void> {
    await this.initialized;
    const next = await fetchManualCandidate(this.options.fetch, this.options.keys, this.now());
    if (next === null) {
      this.set('up-to-date', null);
      return;
    }
    if (
      this.candidate !== null &&
      (compareReleaseVersions(next.release.version, this.candidate.release.version) < 0 ||
        (next.release.version === this.candidate.release.version &&
          next.envelope !== this.candidate.envelope))
    )
      throw new Error('Manual update regressed or changed');
    if (compareReleaseVersions(next.release.version, this.options.currentVersion) <= 0) {
      this.set('up-to-date', null);
      return;
    }
    if (Date.parse(next.release.publishedAt) < this.options.currentPublishedAt)
      throw new Error('Backdated manual release');
    this.candidate = next;
    this.notes = {
      candidate: next,
      highlights: await fetchManualUpdateNotes(
        this.options.fetch,
        this.options.keys,
        next,
        this.now(),
      ),
    };
    if (!(await this.options.eligible(next.envelope, next.release.version))) {
      this.set('not-covered', next.release.version);
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
  readonly download = (): UpdateStatus => {
    if (this.busy || this.candidate === null || !['available', 'failed'].includes(this.value.state))
      return this.value;
    const candidate = this.candidate;
    this.set('downloading', candidate.release.version);
    this.start(async () => {
      if (!(await this.valid(candidate))) throw new Error('Release no longer covered');
      const staged = await downloadManualInstaller(
        candidate,
        this.options.userDataPath,
        this.options.fetch,
      );
      try {
        if (!(await this.valid(staged))) throw new Error('Release no longer covered');
        this.staged = staged;
        this.set('ready', candidate.release.version);
      } catch (error) {
        await discardStagedInstaller(staged);
        throw error;
      }
    });
    return this.value;
  };
  readonly installOnQuit = async (): Promise<UpdateStatus> => {
    if (this.busy || this.staged === null || this.value.state !== 'ready') return this.value;
    this.start(async () => {
      if ((await this.verifiedPath()) === null) throw new Error('Update is not ready');
      this.set('ready', this.value.version, true);
    });
    await this.running;
    return this.value;
  };
  readonly prepareInstall = async (): Promise<string | null> => {
    if (this.busy || this.value.installOnQuit !== true) return null;
    this.set('ready', this.value.version, false);
    try {
      return await this.verifiedPath();
    } catch {
      this.set('failed');
      return null;
    }
  };
  private async valid(candidate: ManualCandidate): Promise<boolean> {
    const release = await verifyManualDownload(
      candidate.envelope,
      manualReleaseKeySet(this.options.keys),
      this.now(),
    );
    if (JSON.stringify(release) !== JSON.stringify(candidate.release)) return false;
    return this.options.eligible(candidate.envelope, release.version);
  }
  private async verifiedPath(): Promise<string | null> {
    const staged = this.staged;
    if (staged === null) return null;
    try {
      if (!(await this.valid(staged))) throw new Error('Update is no longer covered');
      await verifyStagedInstaller(staged);
      if (!(await this.valid(staged))) throw new Error('Update is no longer covered');
      return staged.path;
    } catch (error) {
      this.staged = null;
      await discardStagedInstaller(staged);
      throw error;
    }
  }
}
