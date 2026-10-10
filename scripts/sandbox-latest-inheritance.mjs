// Sandbox-only concurrency guards for approved latest inheritance. Not an atomic source pin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TAG = /^kerfdesk-sandbox-refresh-[0-9a-f-]{36}$/u;
const fail = 'Guarded latest provenance is unavailable or ambiguous.';
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const demand = (value) => assert.ok(value, fail);
const hash = (value) => createHash('sha256').update(value).digest('hex');

function canonical(value, depth = 0) {
  demand(depth <= 16);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    demand(Number.isFinite(value));
    return value;
  }
  if (Array.isArray(value)) {
    demand(value.length <= 100);
    return value.map((entry) => canonical(entry, depth + 1));
  }
  demand(plain(value));
  const keys = Object.keys(value).sort();
  demand(keys.length <= 100);
  return Object.fromEntries(keys.map((key) => [key, canonical(value[key], depth + 1)]));
}

// Pass the actual requested path, never a constant independent of the request.
// The documented standard list's first page is the ten most recent versions.
export function captureUnfilteredPage({ requestedPath, result }) {
  demand(requestedPath === '/versions');
  demand(plain(result) && Array.isArray(result.items));
  demand(result.items.length >= 1 && result.items.length <= 10);
  const rows = result.items.map((entry) => {
    demand(plain(entry) && typeof entry.id === 'string' && UUID.test(entry.id));
    demand(Number.isSafeInteger(entry.number) && entry.number >= 1);
    const encoded = JSON.stringify(canonical(entry));
    demand(encoded.length <= 65536);
    return Object.freeze({
      id: entry.id,
      number: entry.number,
      digest: hash(encoded),
      operationTag: entry.annotations?.['workers/tag'],
    });
  });
  demand(new Set(rows.map((row) => row.id)).size === rows.length);
  demand(new Set(rows.map((row) => row.number)).size === rows.length);
  for (let i = 1; i < rows.length; i++) demand(rows[i - 1].number > rows[i].number);
  return Object.freeze(rows);
}

export function pinLatestOriginal(page, originalVersion, originalInfo, operationTag) {
  demand(Array.isArray(page) && page.length > 0 && page.length <= 10);
  demand(typeof originalVersion === 'string' && UUID.test(originalVersion));
  demand(typeof operationTag === 'string' && TAG.test(operationTag));
  demand(page[0].id === originalVersion);
  demand(originalInfo?.id === originalVersion && originalInfo.number === page[0].number);
  demand(
    Number.isSafeInteger(originalInfo.number) && originalInfo.number < Number.MAX_SAFE_INTEGER,
  );
  demand(page.every((row) => row.operationTag !== operationTag));
  return Object.freeze({
    originalVersion,
    originalNumber: originalInfo.number,
    operationTag,
    page,
  });
}

export function requireUnchangedPreuploadPage(pin, currentPage) {
  demand(currentPage.length === pin.page.length);
  demand(currentPage.every((row, i) => row.digest === pin.page[i].digest));
}

// This permits continued qualification only. Existing code/resource,
// closed-flag, authority, asset, active-UUID and ownership checks remain mandatory.
export function attestAcknowledgedCandidate({
  pin,
  afterPage,
  uploadAcknowledged,
  uploadId,
  candidateInfo,
  activeVersion,
}) {
  demand(uploadAcknowledged === true);
  demand(typeof uploadId === 'string' && UUID.test(uploadId));
  demand(uploadId !== pin.originalVersion && activeVersion === pin.originalVersion);
  demand(candidateInfo?.id === uploadId && afterPage[0]?.id === uploadId);
  demand(candidateInfo.number === pin.originalNumber + 1);
  demand(afterPage[0].number === candidateInfo.number);
  demand(candidateInfo.annotations?.['workers/tag'] === pin.operationTag);
  demand(afterPage[0].operationTag === pin.operationTag);
  demand(afterPage.filter((row) => row.operationTag === pin.operationTag).length === 1);
  const preserved = pin.page.slice(0, 9);
  demand(afterPage.length === preserved.length + 1);
  demand(preserved.every((row, i) => afterPage[i + 1]?.digest === row.digest));
  return Object.freeze({
    inferredProvenance: true,
    atomicSourcePin: false,
    opaqueSecretEqualityProven: false,
    originalVersion: pin.originalVersion,
    candidateVersion: uploadId,
    originalNumber: pin.originalNumber,
    candidateNumber: candidateInfo.number,
    retainedHistoryRows: preserved.length,
  });
}
