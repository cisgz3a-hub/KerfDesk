export interface PreviewManifest {
  schemaVersion: 1;
  channel: 'preview';
  version: string;
  sourceSha: string;
  sourceRef: string;
  publishedAt: string;
  provenance: {
    kind: 'github-attestation' | 'publisher-signature';
    repository: string;
    workflow: string;
    runId: string;
    runAttempt: string;
  };
  artifacts: { name: string; bytes: number; sha256: string }[];
}
export const PREVIEW_ORIGIN: string;
export const PREVIEW_PREFIX: string;
export const PREVIEW_MANIFEST_LIMIT: number;
export function isPreviewVersion(value: unknown): value is string;
export function comparePreviewVersions(left: string, right: string): number;
export function previewArtifactNames(version: string): string[];
export function previewAssetUrl(version: string, name: string): string;
export function validatePreviewPayload(value: unknown, now?: number): PreviewManifest;
export function verifyPreviewManifest(
  text: string,
  keySet: unknown,
  now?: number,
): Promise<PreviewManifest>;
export function readBoundedManifest(response: Response): Promise<string>;
