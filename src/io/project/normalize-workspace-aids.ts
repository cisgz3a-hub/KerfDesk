import { normalizeGuides, type Project } from '../../core/scene';

// Project notes, notes-on-open and guidelines: text and layout aids, kept only
// when well formed. A malformed flag or guide is dropped rather than refusing
// the file; they never affect output.
export function workspaceAids(raw: Record<string, unknown>): {
  readonly notes: string;
  readonly showNotesOnOpen: true | undefined;
  readonly guides: Project['guides'];
} {
  return {
    notes: typeof raw['notes'] === 'string' ? raw['notes'] : '',
    showNotesOnOpen: raw['showNotesOnOpen'] === true ? true : undefined,
    guides: normalizeGuides(raw['guides']),
  };
}
