import {
  nonemptyName,
  personalArtworkProject,
  type PersonalArtwork,
} from './personal-artwork-model';

export function serializePersonalArtworkLibrary(entries: readonly PersonalArtwork[]): string {
  return `${JSON.stringify({ format: 'kerfdesk-artwork-library', version: 1, entries }, null, 2)}\n`;
}

export function parsePersonalArtworkLibrary(json: string): readonly PersonalArtwork[] {
  const raw: unknown = JSON.parse(json);
  if (
    !isRecord(raw) ||
    raw['format'] !== 'kerfdesk-artwork-library' ||
    raw['version'] !== 1 ||
    !Array.isArray(raw['entries'])
  ) {
    throw new Error('This is not a supported KerfDesk artwork library.');
  }
  const entries = raw['entries'].map(parsePersonalArtwork);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error('Duplicate artwork identities in this library.');
  return entries;
}

export function parsePersonalArtwork(raw: unknown): PersonalArtwork {
  if (
    !isRecord(raw) ||
    typeof raw['id'] !== 'string' ||
    raw['id'] === '' ||
    typeof raw['name'] !== 'string' ||
    typeof raw['category'] !== 'string' ||
    typeof raw['projectJson'] !== 'string' ||
    !Array.isArray(raw['selectedObjectIds']) ||
    !raw['selectedObjectIds'].every((id: unknown) => typeof id === 'string')
  ) {
    throw new Error('Saved artwork is malformed.');
  }
  const entry: PersonalArtwork = {
    id: raw['id'],
    name: nonemptyName(raw['name']),
    category: raw['category'],
    projectJson: raw['projectJson'],
    selectedObjectIds: raw['selectedObjectIds'] as string[],
  };
  personalArtworkProject(entry);
  return entry;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}
