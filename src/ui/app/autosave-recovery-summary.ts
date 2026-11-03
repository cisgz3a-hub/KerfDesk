// What the returning-work card and File > Recover unsaved work show for an
// autosaved project (ADR-688): a count of its objects and, for vector work, a
// small picture of it. Autosaves carry no file name, so the picture is what
// tells one unsaved design from another.

import type { Project } from '../../core/scene';
import { exportSceneSvg } from '../../io/svg/export-scene-svg';
import { browserLocalStorage } from '../state/browser-local-storage';

// Images and reliefs would make the picture as heavy as the project itself.
const THUMBNAIL_KINDS = new Set(['imported-svg', 'text', 'shape']);
const THUMBNAIL_MAX_OBJECTS = 400;

export function recoveryObjectSummary(project: Project): string {
  const count = project.scene.objects.length;
  return `${count} object${count === 1 ? '' : 's'}`;
}

/** An SVG data URL of the artwork, or null when no light picture can be drawn. */
export function recoveryThumbnail(project: Project): string | null {
  const objects = project.scene.objects;
  if (objects.length === 0 || objects.length > THUMBNAIL_MAX_OBJECTS) return null;
  if (!objects.every((object) => THUMBNAIL_KINDS.has(object.kind))) return null;
  try {
    const exported = exportSceneSvg(project, undefined, { precisionMm: null });
    if (exported.kind !== 'ok') return null;
    // The export draws hairlines one tenth of a pixel wide; a thumbnail needs
    // them visible at any scale.
    const svg = exported.value.svg.replaceAll('stroke-width="0.1"', 'stroke-width="1.5"');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return null;
  }
}

// Start fresh keeps the autosave (File > Recover unsaved work still lists it)
// but the card does not ask about the same snapshot again.
const START_FRESH_KEY = 'kerfdesk-autosave-start-fresh-v1';
const START_FRESH_LIMIT = 16;

type SnapshotIdentity = { readonly storageKey: string; readonly savedAt: number };

function identity(snapshot: SnapshotIdentity): string {
  return `${snapshot.storageKey}@${snapshot.savedAt}`;
}

function readStartedFresh(storage: Storage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(START_FRESH_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function startedFreshFrom(snapshot: SnapshotIdentity): boolean {
  const storage = browserLocalStorage();
  return storage !== null && readStartedFresh(storage).includes(identity(snapshot));
}

export function rememberStartFresh(snapshot: SnapshotIdentity): void {
  const storage = browserLocalStorage();
  if (storage === null) return;
  const next = [identity(snapshot), ...readStartedFresh(storage)].slice(0, START_FRESH_LIMIT);
  try {
    storage.setItem(START_FRESH_KEY, JSON.stringify([...new Set(next)]));
  } catch {
    // Without storage the card simply asks again next time.
  }
}
