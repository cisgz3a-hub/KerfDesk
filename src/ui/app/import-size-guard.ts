// F-A3 oversize-import guard. A very large file can stall the parse/decode and
// the UI; the spec gates import behind an explicit confirm at 25 MB raw size.
// Shared by every import entry point (SVG drop + picker, image drop + picker)
// so the threshold and copy cannot drift between them.

import { jobAwareConfirm } from '../state/job-aware-dialogs';

const BYTES_PER_MB = 1024 * 1024;
export const MAX_IMPORT_FILE_BYTES = 25 * BYTES_PER_MB;

// Returns true to proceed (file is within the limit, or the operator confirmed),
// false to skip this file.
export function confirmOversizeImport(name: string, sizeBytes: number): boolean {
  if (sizeBytes <= MAX_IMPORT_FILE_BYTES) return true;
  const actualMb = Math.round(sizeBytes / BYTES_PER_MB);
  return jobAwareConfirm(
    `${name} is larger than 25 MB (actual: ${actualMb} MB). Importing it may slow the app. Import anyway?`,
  );
}
