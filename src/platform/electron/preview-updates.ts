import type { DesktopUpdateAdapter, DesktopUpdateAvailability } from '../types';

const PREVIEW_UPDATE_PATH = './api/desktop-preview-update';
const OFFICIAL_RELEASE_BASE = 'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v';
const PREVIEW_VERSION =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-preview\.(0|[1-9][0-9]*)$/;

type FetchUpdate = (input: string, init: RequestInit) => Promise<Response>;

export function createDesktopPreviewUpdateAdapter(
  fetchUpdate: FetchUpdate = (input, init) => fetch(input, init),
): DesktopUpdateAdapter {
  let pending: Promise<DesktopUpdateAvailability> | undefined;
  return {
    downloadPageUrl: (version) => `${OFFICIAL_RELEASE_BASE}${version}`,
    checkForUpdate: () => {
      pending ??= requestPreviewUpdate(fetchUpdate);
      return pending;
    },
  };
}

async function requestPreviewUpdate(fetchUpdate: FetchUpdate): Promise<DesktopUpdateAvailability> {
  try {
    const response = await fetchUpdate(PREVIEW_UPDATE_PATH, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return { kind: 'none' };
    const value: unknown = await response.json();
    return parseAvailability(value);
  } catch {
    return { kind: 'none' };
  }
}

function parseAvailability(value: unknown): DesktopUpdateAvailability {
  if (typeof value !== 'object' || value === null) return { kind: 'none' };
  const candidate = value as Record<string, unknown>;
  if (candidate['kind'] === 'none') return { kind: 'none' };
  const version = candidate['version'];
  if (candidate['kind'] !== 'available' || typeof version !== 'string') return { kind: 'none' };
  return PREVIEW_VERSION.test(version) ? { kind: 'available', version } : { kind: 'none' };
}
