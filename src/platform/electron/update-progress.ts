import type { CommercialUpdateStatus, ManualUpdateDownloadProgress } from '../types';

function validByteCounts(progress: ManualUpdateDownloadProgress): boolean {
  return (
    Number.isSafeInteger(progress.totalBytes) &&
    progress.totalBytes > 0 &&
    progress.totalBytes <= 300_000_000 &&
    Number.isSafeInteger(progress.receivedBytes) &&
    progress.receivedBytes >= 0 &&
    progress.receivedBytes <= progress.totalBytes
  );
}

/** Optional legacy-compatible metadata is never installation authority. */
export function validUpdateProgress(status: CommercialUpdateStatus): boolean {
  const progress = status.downloadProgress;
  if (progress === undefined) return true;
  if (
    progress === null ||
    typeof progress !== 'object' ||
    status.mode !== 'manual' ||
    status.state !== 'downloading' ||
    status.version === null ||
    !['starting', 'receiving', 'verifying'].includes(progress.phase) ||
    !validByteCounts(progress)
  )
    return false;
  return (
    (progress.phase !== 'starting' || progress.receivedBytes === 0) &&
    (progress.phase !== 'verifying' || progress.receivedBytes === progress.totalBytes)
  );
}
