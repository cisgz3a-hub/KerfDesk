export interface UpdateNotesRelease {
  version: string;
  sourceSha: string;
  publishedAt: string;
}
export interface DesktopUpdateNotes extends UpdateNotesRelease {
  schemaVersion: 1;
  product: 'kerfdesk-desktop';
  kind: 'update-notes';
  channel: 'stable';
  highlights: string[];
}
export const UPDATE_NOTES_LIMIT: number;
export function updateNotesUrl(version: string): string;
export function validateUpdateHighlights(value: unknown): string[];
export function validateUpdateNotes(
  value: unknown,
  release: UpdateNotesRelease,
  now?: number,
): DesktopUpdateNotes;
export function verifyUpdateNotes(
  text: string,
  keySet: unknown,
  release: UpdateNotesRelease,
  now?: number,
): Promise<DesktopUpdateNotes>;
