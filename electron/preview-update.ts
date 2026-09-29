// Preview discovery verifies publisher-signed metadata only; installation stays manual.
import { readFileSync } from 'node:fs';
import {
  comparePreviewVersions,
  isPreviewVersion,
  PREVIEW_ORIGIN,
  PREVIEW_PREFIX,
  readBoundedManifest,
  verifyPreviewManifest,
} from '../public/desktop-release-manifest.mjs';

export const PREVIEW_UPDATE_API_PATH = '/api/desktop-preview-update';
export const PREVIEW_MANIFEST_URL = `${PREVIEW_ORIGIN}/${PREVIEW_PREFIX}/latest.json`;
export type PreviewUpdateAvailability =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly version: string };
export type PreviewUpdateCheckOptions = {
  readonly enabled: boolean;
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  // Retained adapter name for the existing main-process net.fetch injection.
  readonly fetchWorkflowRuns: (url: string, init: RequestInit) => Promise<Response>;
  readonly onError?: (error: unknown) => void;
  readonly trustedKeys?: unknown;
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
  if (!options.enabled || !isPreviewVersion(options.currentVersion)) return { kind: 'none' };
  if (
    !(
      (options.platform === 'win32' && options.arch === 'x64') ||
      (options.platform === 'darwin' && ['x64', 'arm64'].includes(options.arch))
    )
  )
    return { kind: 'none' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const keys: unknown =
      options.trustedKeys ??
      JSON.parse(
        readFileSync(new URL('../public/desktop-release-keys.json', import.meta.url), 'utf8'),
      );
    const response = await options.fetchWorkflowRuns(PREVIEW_MANIFEST_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'KerfDesk-Desktop-Preview' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const manifest = await verifyPreviewManifest(await readBoundedManifest(response), keys);
    return comparePreviewVersions(manifest.version, options.currentVersion) > 0
      ? { kind: 'available', version: manifest.version }
      : { kind: 'none' };
  } catch (error) {
    options.onError?.(error);
    return { kind: 'none' };
  } finally {
    clearTimeout(timeout);
  }
}
