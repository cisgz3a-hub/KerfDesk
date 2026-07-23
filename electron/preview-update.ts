// Unsigned Preview update discovery (ADR-249).
//
// This is deliberately separate from electron-updater. Preview builds may ask
// GitHub whether a newer Preview release workflow completed successfully, but
// they never download, execute, or install it. A green workflow is the release
// certificate: its final job verifies the immutable prerelease, exact assets,
// checksums, source manifest, and attestations. The renderer receives only a
// validated version string through the app:// same-origin protocol.

export const PREVIEW_UPDATE_API_PATH = '/api/desktop-preview-update';
export const PREVIEW_WORKFLOW_RUNS_API_URL =
  'https://api.github.com/repos/cisgz3a-hub/KerfDesk/actions/workflows/release-desktop-preview.yml/runs?event=push&status=success&per_page=20';

const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const PREVIEW_WORKFLOW_PATH = '.github/workflows/release-desktop-preview.yml';
const PREVIEW_TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-preview\.(0|[1-9][0-9]*)$/;

export type PreviewUpdateAvailability =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly version: string };

type PreviewVersion = {
  readonly tag: string;
  readonly version: string;
  readonly parts: readonly [bigint, bigint, bigint, bigint];
};

type PreviewWorkflowRunsFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PreviewUpdateCheckOptions = {
  readonly enabled: boolean;
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly fetchWorkflowRuns: PreviewWorkflowRunsFetch;
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
  if (!isSupportedPreviewTarget(options.platform, options.arch)) return { kind: 'none' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await options.fetchWorkflowRuns(PREVIEW_WORKFLOW_RUNS_API_URL, {
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
    const workflowRuns = await readWorkflowRunList(response);
    if (workflowRuns === null) return { kind: 'none' };
    return newestAvailablePreview(workflowRuns, current);
  } catch (error) {
    options.onError?.(error);
    return { kind: 'none' };
  } finally {
    clearTimeout(timeout);
  }
}

function newestAvailablePreview(
  workflowRuns: ReadonlyArray<unknown>,
  current: PreviewVersion,
): PreviewUpdateAvailability {
  let newest: PreviewVersion | null = null;
  for (const workflowRun of workflowRuns) {
    const candidate = validWorkflowRunVersion(workflowRun);
    if (candidate === null || comparePreviewVersions(candidate, current) <= 0) continue;
    if (newest === null || comparePreviewVersions(candidate, newest) > 0) newest = candidate;
  }
  return newest === null ? { kind: 'none' } : { kind: 'available', version: newest.version };
}

function validWorkflowRunVersion(value: unknown): PreviewVersion | null {
  if (!isRecord(value)) return null;
  if (
    value['status'] !== 'completed' ||
    value['conclusion'] !== 'success' ||
    value['event'] !== 'push' ||
    value['path'] !== PREVIEW_WORKFLOW_PATH
  ) {
    return null;
  }
  if (typeof value['head_sha'] !== 'string' || !/^[0-9a-f]{40}$/.test(value['head_sha'])) {
    return null;
  }
  return parsePreviewTag(value['head_branch']);
}

async function readWorkflowRunList(response: Response): Promise<ReadonlyArray<unknown> | null> {
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
  if (!isRecord(parsed) || !Array.isArray(parsed['workflow_runs'])) return null;
  return parsed['workflow_runs'];
}

function isSupportedPreviewTarget(platform: NodeJS.Platform, arch: string): boolean {
  return (
    (platform === 'win32' && arch === 'x64') ||
    (platform === 'darwin' && (arch === 'x64' || arch === 'arm64'))
  );
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
