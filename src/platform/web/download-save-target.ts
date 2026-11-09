// Firefox and Safari have no save picker (ADR-688). Without one, Save, Save As
// and every export hand the bytes to the browser as a download instead
// (ADR-688 Amendment 2): an anchor with a `download` name and a Blob URL, the
// route every browser has. The browser picks the folder (normally Downloads)
// and may rename a file that is already there, so the target has no identity
// to compare and no handle for Recent Projects. Each write downloads a fresh
// copy; nothing is ever written over.

import type { SaveTarget } from '../types';

/** The adapter-owned identity of a download. Never equal to any other target. */
export type DownloadSaveDestination = { readonly kind: 'download'; readonly displayName: string };

// Revoking the URL in the click's own task can cancel the download in older
// WebKit and Gecko; a minute is ample for the browser to take the bytes.
export const DOWNLOAD_URL_REVOKE_MS = 60_000;

type DownloadEnvironment = {
  readonly document: Document;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
};

function browserDownloadEnvironment(): DownloadEnvironment {
  return {
    document,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  };
}

/** Whether this browser can hand bytes to the user as a download. */
export function downloadsAvailable(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/** Hand `data` to the browser as a file called `fileName`. */
export function downloadFile(
  fileName: string,
  data: string | Blob,
  env: DownloadEnvironment = browserDownloadEnvironment(),
): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
  const url = env.createObjectURL(blob);
  const anchor = env.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  env.document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    env.setTimeout(() => env.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_MS);
  }
}

/** A SaveTarget that downloads each write under `displayName`. */
export function downloadSaveTarget(displayName: string, env?: DownloadEnvironment): SaveTarget {
  const identity: DownloadSaveDestination = { kind: 'download', displayName };
  return {
    displayName,
    delivery: 'download',
    destinationIdentity: identity,
    // A download has no entry to compare: the browser chooses the folder and
    // may add " (1)", so no two downloads are provably the same file.
    isSameDestination: async () => false,
    compareDestination: async () => 'unknown',
    write: async (data) => downloadFile(displayName, data, env),
  };
}
