import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import type { GcodeFingerprint } from '../../../core/recovery';
import type { ExecutionArtifactV1 } from '../../state/recovery';

const LEGACY_KEY = 'kerfdesk.second-pass-draft.v1';
const KEY = 'kerfdesk.second-pass-drafts.v2';
const MAX_DRAFTS = 20;
type DraftSource = Pick<ExecutionArtifactV1, 'runId' | 'fingerprint'>;
type Draft = DraftSource & { readonly strokes: LaserSecondPassSelection['strokes'] };

export function loadSecondPassDraft(source: DraftSource): LaserSecondPassSelection['strokes'] {
  try {
    const current = localStorage.getItem(KEY);
    // Once migration succeeds this envelope is authoritative. An evicted or
    // explicitly cleared draft must not reappear from the retained legacy key.
    const drafts = current === null ? legacyDrafts() : readEnvelope(current);
    return drafts?.find((draft) => sourceKey(draft) === sourceKey(source))?.strokes ?? [];
  } catch {
    return [];
  }
}

export function saveSecondPassDraft(
  source: DraftSource,
  strokes: LaserSecondPassSelection['strokes'],
): boolean {
  try {
    const draft: Draft = { runId: source.runId, fingerprint: source.fingerprint, strokes };
    if (!validDraft(draft)) return false;
    const current = localStorage.getItem(KEY);
    const previous = current === null ? legacyDrafts() : readEnvelope(current);
    // Never overwrite malformed/future storage with an empty inferred history.
    if (previous === null) return false;
    const key = sourceKey(source);
    const drafts = [...previous.filter((item) => sourceKey(item) !== key), draft].slice(
      -MAX_DRAFTS,
    );
    // One atomic storage replacement: quota failure leaves every previous draft
    // (including the oldest that would be evicted) intact, and reports failure.
    localStorage.setItem(KEY, JSON.stringify({ version: 2, drafts }));
    return true;
  } catch {
    return false;
  }
}

function sourceKey(source: DraftSource): string {
  const fingerprint = source.fingerprint;
  return JSON.stringify([source.runId, fingerprint.fnv1a, fingerprint.chars, fingerprint.lines]);
}

function readEnvelope(raw: string): ReadonlyArray<Draft> | null {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const drafts = record['drafts'];
  if (record['version'] !== 2 || !Array.isArray(drafts) || drafts.length > MAX_DRAFTS) return null;
  if (!drafts.every(validDraft)) return null;
  return new Set(drafts.map(sourceKey)).size === drafts.length ? drafts : null;
}

function legacyDrafts(): ReadonlyArray<Draft> {
  // Keep the old key untouched, even if its contents cannot be migrated. A new
  // envelope can be saved without deleting that potentially recoverable data.
  const raw = localStorage.getItem(LEGACY_KEY);
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (typeof record['fingerprint'] !== 'string') return [];
    const fingerprint: unknown = JSON.parse(record['fingerprint']);
    const candidate = { ...record, fingerprint };
    return validDraft(candidate) ? [candidate] : [];
  } catch {
    return [];
  }
}

function validDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft['runId'] === 'string' &&
    validFingerprint(draft['fingerprint']) &&
    Array.isArray(draft['strokes']) &&
    draft['strokes'].every(validStroke)
  );
}

function validFingerprint(value: unknown): value is GcodeFingerprint {
  if (!value || typeof value !== 'object') return false;
  const fingerprint = value as Record<string, unknown>;
  return (
    nonNegativeInteger(fingerprint['fnv1a']) &&
    fingerprint['fnv1a'] <= 0xffffffff &&
    nonNegativeInteger(fingerprint['chars']) &&
    nonNegativeInteger(fingerprint['lines']) &&
    fingerprint['lines'] > 0
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validStroke(value: unknown): value is LaserSecondPassSelection['strokes'][number] {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    (s['mode'] === 'paint' || s['mode'] === 'erase') &&
    positiveNumber(s['radiusMm']) &&
    positiveNumber(s['powerScale']) &&
    Array.isArray(s['points']) &&
    s['points'].length > 0 &&
    s['points'].every((p: unknown) => {
      if (!p || typeof p !== 'object') return false;
      const point = p as Record<string, unknown>;
      return (
        typeof point['x'] === 'number' &&
        Number.isFinite(point['x']) &&
        typeof point['y'] === 'number' &&
        Number.isFinite(point['y'])
      );
    })
  );
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
