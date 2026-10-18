export type DownloadPlatform = 'macos' | 'linux';
export interface PlatformDownload {
  schemaVersion: 1;
  product: 'kerfdesk-desktop';
  kind: 'platform-download';
  channel: 'stable';
  platform: DownloadPlatform;
  version: string;
  sourceSha: string;
  sourceRef: string;
  publishedAt: string;
  codeSigning: 'unsigned' | 'developer-id';
  updates: 'manual';
  artifacts: { name: string; bytes: number; sha256: string }[];
}
export const PLATFORM_DOWNLOAD_LIMIT: number;
export const DOWNLOAD_PLATFORMS: readonly DownloadPlatform[];
export function platformArtifactNames(platform: DownloadPlatform, version: string): string[];
export function platformLatestKey(platform: DownloadPlatform): string;
export function platformLatestUrl(platform: DownloadPlatform): string;
export function platformManifestName(platform: DownloadPlatform): string;
export function platformDownloadKey(
  platform: DownloadPlatform,
  version: string,
  name: string,
): string;
export function platformDownloadUrl(
  platform: DownloadPlatform,
  version: string,
  name: string,
): string;
export function validatePlatformDownload(value: unknown, now?: number): PlatformDownload;
export function verifyPlatformDownload(
  text: string,
  keySet: unknown,
  platform: DownloadPlatform,
  now?: number,
): Promise<PlatformDownload>;
