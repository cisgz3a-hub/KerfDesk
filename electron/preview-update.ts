// Unsigned Preview update discovery (ADR-249).
//
// This is deliberately separate from electron-updater. Preview builds may ask
// GitHub whether a newer immutable prerelease exists, but they never download,
// execute, or install it. The renderer receives only a validated version string
// through the app:// same-origin protocol and opens KerfDesk's fixed download
// page when the operator chooses to act.

export const PREVIEW_UPDATE_API_PATH = '/api/desktop-preview-update';
export const PREVIEW_RELEASES_API_URL =
  'https://api.github.com/repos/cisgz3a-hub/KerfDesk/releases?per_page=20';

const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const PREVIEW_TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-preview\.(0|[1-9][0-9]*)$/;

export type PreviewUpdateAvailability =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly version: string };

type PreviewVersion = {
  readonly tag: string;
  readonly version: string;
  readonly parts: readonly [bigint, bigint, bigint, bigint];
};

type PreviewUpdateFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PreviewUpdateCheckOptions = {
  readonly enabled: boolean;
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly fetchReleases: PreviewUpdateFetch;
  readonly onError?: (error: unknown) => void;
};

export function isExactPreviewUpdateApiRequest(request: {
  readonly method: string;
  readonly url: string;
}): boolean {
  try {
    const url = new URL(request.url);
    return (
      request.method === 'GET' &&
      url.protocol === 'app:' &&
      url.hostname === 'app' &&
      url.pathname === PREVIEW_UPDATE_API_PATH &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

export function createPreviewUpdateCheck(
  options: PreviewUpdateCheckOptions,
): () => Promise<PreviewUpdateAvailability> {
  let pending: Promise<PreviewUpdateAvailability> | undefined;
  return () => {
    pending ??= checkForPreviewUpdate(options);
    return pending;
  };
}

export async function checkForPreviewUpdate(
  options: PreviewUpdateCheckOptions,
): Promise<PreviewUpdateAvailability> {
  if (!options.enabled) return { kind: 'none' };
  const current = parsePreviewTag(`v${options.currentVersion}`);
  if (current === null) return { kind: 'none' };
  const expectedAsset = previewAssetName(options.platform, options.arch);
  if (expectedAsset === null) return { kind: 'none' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await options.fetchReleases(PREVIEW_RELEASES_API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'KerfDesk-Desktop-Preview',
      },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const releases = await readReleaseList(response);
    if (releases === null) return { kind: 'none' };
    return newestAvailablePreview(releases, current, expectedAsset);
  } catch (error) {
    options.onError?.(error);
    return { kind: 'none' };
  } finally {
    clearTimeout(timeout);
  }
}

function newestAvailablePreview(
  releases: ReadonlyArray<unknown>,
  current: PreviewVersion,
  expectedAsset: (version: string) => string,
): PreviewUpdateAvailability {
  let newest: PreviewVersion | null = null;
  for (const release of releases) {
    const candidate = validReleaseVersion(release, expectedAsset);
    if (candidate === null || comparePreviewVersions(candidate, current) <= 0) continue;
    if (newest === null || comparePreviewVersions(candidate, newest) > 0) newest = candidate;
  }
  return newest === null ? { kind: 'none' } : { kind: 'available', version: newest.version };
}

function validReleaseVersion(
  value: unknown,
  expectedAsset: (version: string) => string,
): PreviewVersion | null {
  if (!isRecord(value)) return null;
  if (value['draft'] !== false || value['prerelease'] !== true || value['immutable'] !== true) {
    return null;
  }
  const tag = parsePreviewTag(value['tag_name']);
  if (tag === null || !Array.isArray(value['assets'])) return null;
  const assetNames = value['assets'].flatMap((asset) =>
    isRecord(asset) && typeof asset['name'] === 'string' ? [asset['name']] : [],
  );
  const requiredNames = previewReleaseAssetNames(tag.version);
  const exactAssetSet =
    assetNames.length === requiredNames.length &&
    new Set(assetNames).size === requiredNames.length &&
    requiredNames.every((name) => assetNames.includes(name));
  return exactAssetSet && assetNames.includes(expectedAsset(tag.version)) ? tag : null;
}

function previewReleaseAssetNames(version: string): readonly string[] {
  return [
    `KerfDesk-${version}-windows-x64-setup.exe`,
    `KerfDesk-${version}-macos-x64.dmg`,
    `KerfDesk-${version}-macos-arm64.dmg`,
    `KerfDesk-${version}-SHA256SUMS.txt`,
    `KerfDesk-${version}-release-manifest.json`,
    `KerfDesk-${version}-sbom.cdx.json`,
  ];
}

async function readReleaseList(response: Response): Promise<ReadonlyArray<unknown> | null> {
  if (response.status !== 200) return null;
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) return null;
  if (response.body === null) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const text = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    receivedBytes,
  ).toString('utf8');
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : null;
}

function previewAssetName(
  platform: NodeJS.Platform,
  arch: string,
): ((version: string) => string) | null {
  if (platform === 'win32' && arch === 'x64') {
    return (version) => `KerfDesk-${version}-windows-x64-setup.exe`;
  }
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return (version) => `KerfDesk-${version}-macos-${arch}.dmg`;
  }
  return null;
}

function parsePreviewTag(value: unknown): PreviewVersion | null {
  if (typeof value !== 'string') return null;
  const match = PREVIEW_TAG.exec(value);
  if (match === null) return null;
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  const preview = match[4];
  if (major === undefined || minor === undefined || patch === undefined || preview === undefined) {
    return null;
  }
  return {
    tag: value,
    version: value.slice(1),
    parts: [BigInt(major), BigInt(minor), BigInt(patch), BigInt(preview)],
  };
}

function comparePreviewVersions(left: PreviewVersion, right: PreviewVersion): number {
  for (let index = 0; index < left.parts.length; index += 1) {
    const leftPart = left.parts[index];
    const rightPart = right.parts[index];
    if (leftPart === undefined || rightPart === undefined || leftPart === rightPart) continue;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
