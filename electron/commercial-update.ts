import { record, verifyLicenceRelease, type PublicKeys } from './licensing-verification.js';

const ORIGIN = 'https://dl.kerfdesk.com/desktop/commercial';
const LIMIT = 256 * 1024;
const VERSION = /^(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})$/;

export type CommercialUpdater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  disableWebInstaller: boolean;
  disableDifferentialDownload: boolean;
  setFeedURL: (options: { provider: 'generic'; url: string }) => void;
  checkForUpdates: () => Promise<{ isUpdateAvailable: boolean; updateInfo: unknown } | null>;
  downloadUpdate: () => Promise<string[]>;
  on: (event: 'update-downloaded', listener: (info: unknown) => void) => unknown;
  removeListener: (event: 'update-downloaded', listener: (info: unknown) => void) => unknown;
};
type Artifact = {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sha512: string;
};
type Candidate = {
  readonly envelope: unknown;
  readonly version: string;
  readonly installer: Artifact;
};
type Options = {
  readonly isPackaged: boolean;
  readonly isChannelTrusted: boolean;
  readonly platform: string;
  readonly currentVersion: string;
  readonly releaseKeys: PublicKeys;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly isEligible: (envelope: unknown, version: string) => Promise<boolean>;
  readonly isEligibleCached: (envelope: unknown, version: string) => boolean;
  readonly now?: () => number;
  readonly onVerifiedDownload?: (envelope: unknown, version: string) => void;
};

function compare(left: string, right: string): number {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x !== undefined && y !== undefined && x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function artifact(value: unknown): value is Artifact {
  return (
    record(value) &&
    Object.keys(value).sort().join(',') === 'bytes,name,sha256,sha512' &&
    typeof value.name === 'string' &&
    typeof value.bytes === 'number' &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= 600_000_000 &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.sha512 === 'string' &&
    /^[A-Za-z0-9+/]{86}==$/.test(value.sha512) &&
    Buffer.from(value.sha512, 'base64').toString('base64') === value.sha512
  );
}

export function commercialUpdateCandidate(
  envelope: unknown,
  keys: PublicKeys,
  now = Date.now(),
): Candidate | null {
  const release = verifyLicenceRelease(envelope, keys, 'update-manifest');
  if (
    release === null ||
    !VERSION.test(release.version) ||
    release.publishedAt * 1000 > now + 300_000 ||
    !record(envelope) ||
    typeof envelope.payload !== 'string'
  )
    return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
    const installer = manifestInstaller(value, release.version);
    return installer === null ? null : { envelope, version: release.version, installer };
  } catch {
    return null;
  }
}

function manifestInstaller(value: unknown, version: string): Artifact | null {
  if (
    !record(value) ||
    value.kind !== 'update-manifest' ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length !== 3
  )
    return null;
  const name = `KerfDesk-${version}-windows-x64-setup.exe`;
  const names = [name, `${name}.blockmap`, 'latest.yml'].sort().join(',');
  if (
    !value.artifacts.every(artifact) ||
    value.artifacts
      .map((item) => item.name)
      .sort()
      .join(',') !== names
  )
    return null;
  return value.artifacts.find((item) => item.name === name) ?? null;
}

function validLength(length: string | null): boolean {
  return length === null || (/^\d+$/.test(length) && Number(length) <= LIMIT);
}

async function readCatalog(response: Response): Promise<unknown[]> {
  if (response.status !== 200 || response.body === null)
    throw new Error('Update catalog unavailable');
  const length = response.headers.get('content-length');
  if (!validLength(length)) throw new Error('Invalid update catalog');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > LIMIT) throw new Error('Update catalog too large');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.releases) ||
    value.releases.length > 64
  )
    throw new Error('Invalid update catalog');
  return value.releases;
}

export function updateInfoMatchesManifest(info: unknown, candidate: Candidate): boolean {
  if (
    !record(info) ||
    info.version !== candidate.version ||
    !Array.isArray(info.files) ||
    info.files.length !== 1
  )
    return false;
  return (
    installerFileMatches(info.files[0], candidate.installer) &&
    info.path === candidate.installer.name &&
    info.sha512 === candidate.installer.sha512 &&
    info.packages === undefined
  );
}

function installerFileMatches(file: unknown, expected: Artifact): boolean {
  return (
    record(file) &&
    file.url === expected.name &&
    file.size === expected.bytes &&
    file.sha512 === expected.sha512 &&
    (file.isAdminRightsRequired === undefined || file.isAdminRightsRequired === false)
  );
}

/**
 * Each catalogue entry carries its own signature, so one damaged, unsigned or
 * not-yet-published entry is skipped instead of stopping every update
 * (ADR-523 Amendment 1). Two entries for one version are ambiguous, so that
 * version is skipped too. Newest first.
 */
export function trustedCandidates(
  envelopes: ReadonlyArray<unknown>,
  options: Pick<Options, 'releaseKeys' | 'now'>,
): Candidate[] {
  const candidates = envelopes
    .map((value) => commercialUpdateCandidate(value, options.releaseKeys, options.now?.()))
    .filter((value): value is Candidate => value !== null);
  const skipped = envelopes.length - candidates.length;
  if (skipped > 0) console.warn(`Skipped ${skipped} unverifiable update catalogue entries.`);
  const counts = new Map<string, number>();
  for (const candidate of candidates)
    counts.set(candidate.version, (counts.get(candidate.version) ?? 0) + 1);
  return candidates
    .filter((candidate) => counts.get(candidate.version) === 1)
    .sort((a, b) => compare(b.version, a.version));
}

function canCheck(options: Options): boolean {
  return (
    options.isPackaged &&
    options.isChannelTrusted &&
    options.platform === 'win32' &&
    VERSION.test(options.currentVersion)
  );
}

/** Dedicated commercial feed; free installers never use this path. No forced quit. */
export async function checkCommercialUpdates(
  updater: CommercialUpdater,
  options: Options,
): Promise<void> {
  if (!canCheck(options)) return;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.disableWebInstaller = true;
  // Whole-file SHA-512 from the signed manifest is the authority for this lane.
  updater.disableDifferentialDownload = true;
  const envelopes = await readCatalog(
    await options.fetch(`${ORIGIN}/catalog.json`, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    }),
  );
  const valid = trustedCandidates(envelopes, options);
  for (const candidate of valid) {
    if (
      compare(candidate.version, options.currentVersion) <= 0 ||
      !(await options.isEligible(candidate.envelope, candidate.version))
    )
      continue;
    updater.setFeedURL({ provider: 'generic', url: `${ORIGIN}/releases/${candidate.version}` });
    const result = await updater.checkForUpdates();
    if (result === null || result.isUpdateAvailable !== true) return;
    if (!updateInfoMatchesManifest(result.updateInfo, candidate))
      throw new Error('Update feed does not match signed release');
    if (!(await options.isEligible(candidate.envelope, candidate.version))) return;
    await downloadVerifiedCandidate(updater, options, candidate);
    return;
  }
}

async function downloadVerifiedCandidate(
  updater: CommercialUpdater,
  options: Options,
  candidate: Candidate,
): Promise<void> {
  // electron-updater dispatches this event immediately BEFORE addQuitHandler.
  // Arming after await downloadUpdate() would miss that registration entirely.
  const downloaded = (info: unknown): void => {
    updater.autoInstallOnAppQuit = false;
    if (
      !updateInfoMatchesManifest(info, candidate) ||
      !options.isEligibleCached(candidate.envelope, candidate.version)
    )
      return;
    options.onVerifiedDownload?.(candidate.envelope, candidate.version);
    updater.autoInstallOnAppQuit = true;
  };
  updater.on('update-downloaded', downloaded);
  try {
    await updater.downloadUpdate();
    // This asynchronous recheck can disarm, never arm a skipped quit handler.
    if (!(await options.isEligible(candidate.envelope, candidate.version)))
      updater.autoInstallOnAppQuit = false;
  } catch (error) {
    updater.autoInstallOnAppQuit = false;
    throw error;
  } finally {
    updater.removeListener('update-downloaded', downloaded);
  }
}
