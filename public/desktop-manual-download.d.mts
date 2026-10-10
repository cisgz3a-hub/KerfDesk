export interface ManualDownload {
  schemaVersion: 1;
  product: 'kerfdesk-desktop';
  kind: 'manual-download';
  channel: 'stable';
  version: string;
  sourceSha: string;
  sourceRef: string;
  publishedAt: string;
  codeSigning: 'unsigned' | 'authenticode';
  updates: 'manual';
  artifacts: [{ name: string; bytes: number; sha256: string }];
}
export const MANUAL_DOWNLOAD_PREFIX: string;
export const MANUAL_DOWNLOAD_LATEST_KEY: string;
export const MANUAL_DOWNLOAD_LATEST_URL: string;
export const MANUAL_DOWNLOAD_LIMIT: number;
export function manualDownloadKey(version: string, name: string): string;
export function manualDownloadUrl(version: string, name: string): string;
export function validateManualDownload(value: unknown, now?: number): ManualDownload;
export function verifyManualDownload(
  text: string,
  keySet: unknown,
  now?: number,
): Promise<ManualDownload>;
