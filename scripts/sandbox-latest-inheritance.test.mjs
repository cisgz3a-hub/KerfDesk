import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureUnfilteredPage,
  pinLatestOriginal,
  requireUnchangedPreuploadPage,
  attestAcknowledgedCandidate,
} from './sandbox-latest-inheritance.mjs';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const operationTag = `kerfdesk-sandbox-refresh-${id(100)}`;
const entry = (number) => ({
  id: id(number),
  number,
  metadata: { created_on: `2026-10-10T12:00:${String(number).padStart(2, '0')}Z`, source: 'api' },
});
const capture = (items, requestedPath = '/versions') =>
  captureUnfilteredPage({ requestedPath, result: { items } });
function fixture(length = 3) {
  const before = Array.from({ length }, (_, index) => entry(20 - index));
  const candidate = { ...entry(21), annotations: { 'workers/tag': operationTag } };
  const page = capture(before);
  const pin = pinLatestOriginal(page, id(20), before[0], operationTag);
  return {
    before,
    candidate,
    page,
    pin,
    args: {
      pin,
      afterPage: capture([candidate, ...before].slice(0, 10)),
      uploadAcknowledged: true,
      uploadId: id(21),
      candidateInfo: candidate,
      activeVersion: id(20),
    },
  };
}
const refuse = (fn) =>
  assert.throws(fn, { message: 'Guarded latest provenance is unavailable or ambiguous.' });

test('clean acknowledged adjacent history yields explicitly limited inference', () => {
  const { args, pin, page } = fixture();
  requireUnchangedPreuploadPage(pin, page);
  const result = attestAcknowledgedCandidate(args);
  assert.equal(result.inferredProvenance, true);
  assert.equal(result.atomicSourcePin, false);
  assert.equal(result.opaqueSecretEqualityProven, false);
});
test('full first page permits only the unavoidable oldest-row displacement', () => {
  const { args, before, candidate } = fixture(10);
  assert.equal(attestAcknowledgedCandidate(args).retainedHistoryRows, 9);
  args.afterPage = capture([candidate, ...before.slice(0, 8)]);
  refuse(() => attestAcknowledgedCandidate(args));
});
test('filtered, query-bearing and unknown list paths refuse', () => {
  for (const path of [
    '/versions?deployable=true',
    '/versions?per_page=10',
    '/versions/',
    undefined,
  ]) {
    refuse(() => captureUnfilteredPage({ requestedPath: path, result: { items: [entry(20)] } }));
  }
});
test('missing, empty and overbounded pages refuse', () => {
  for (const result of [
    null,
    {},
    { items: {} },
    { items: [] },
    { items: Array.from({ length: 11 }, (_, i) => entry(20 - i)) },
  ]) {
    refuse(() => captureUnfilteredPage({ requestedPath: '/versions', result }));
  }
});
test('malformed IDs, missing/fractional/unsafe numbers and malformed rows refuse', () => {
  for (const row of [
    null,
    [],
    { number: 20 },
    { ...entry(20), id: 'unknown' },
    { ...entry(20), number: undefined },
    { ...entry(20), number: 0 },
    { ...entry(20), number: 20.5 },
    { ...entry(20), number: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    refuse(() => capture([row]));
  }
});
test('duplicate IDs, duplicate numbers and unsorted pages refuse', () => {
  for (const rows of [
    [entry(20), entry(20)],
    [entry(20), { ...entry(19), id: id(20) }],
    [entry(20), { ...entry(19), number: 20 }],
    [entry(19), entry(20)],
  ])
    refuse(() => capture(rows));
});
test('unrecognised newest version and disagreeing exact-original detail refuse', () => {
  const { page, before } = fixture();
  refuse(() => pinLatestOriginal(page, id(19), before[1], operationTag));
  refuse(() => pinLatestOriginal(page, id(20), { ...before[0], number: 19 }, operationTag));
  refuse(() => pinLatestOriginal(page, id(20), { ...before[0], id: id(19) }, operationTag));
});
test('operation tag already present before staging refuses', () => {
  const rows = [{ ...entry(20), annotations: { 'workers/tag': operationTag } }];
  refuse(() => pinLatestOriginal(capture(rows), id(20), rows[0], operationTag));
});
test('any preupload insertion deletion or metadata drift refuses', () => {
  const { pin, before } = fixture();
  for (const rows of [
    [entry(21), ...before],
    before.slice(0, 2),
    before.map((row, i) => (i === 1 ? { ...row, unknown_future_field: true } : row)),
  ]) {
    refuse(() => requireUnchangedPreuploadPage(pin, capture(rows)));
  }
});
test('intervening candidate, hidden-history omission and metadata drift refuse', () => {
  const { args, before, candidate } = fixture();
  const delayedCandidate = { ...candidate, id: id(22), number: 22 };
  refuse(() =>
    attestAcknowledgedCandidate({
      ...args,
      uploadId: id(22),
      candidateInfo: delayedCandidate,
      afterPage: capture([delayedCandidate, entry(21), ...before]),
    }),
  );
  refuse(() =>
    attestAcknowledgedCandidate({
      ...args,
      uploadId: id(22),
      candidateInfo: delayedCandidate,
      afterPage: capture([delayedCandidate, ...before]),
    }),
  );
  refuse(() =>
    attestAcknowledgedCandidate({
      ...args,
      afterPage: capture([
        candidate,
        before[0],
        { ...before[1], unknown_future_field: true },
        before[2],
      ]),
    }),
  );
});
test('a later unrelated staged version blocks activation qualification', () => {
  const { args, before, candidate } = fixture();
  refuse(() =>
    attestAcknowledgedCandidate({ ...args, afterPage: capture([entry(22), candidate, ...before]) }),
  );
});
test('lost acknowledgment never qualifies even when tagged candidate is discovered', () => {
  const { args } = fixture();
  for (const acknowledged of [false, undefined, null, 'true', 1])
    refuse(() => attestAcknowledgedCandidate({ ...args, uploadAcknowledged: acknowledged }));
  refuse(() => attestAcknowledgedCandidate({ ...args, uploadId: undefined }));
});
test('active deployment change and candidate identity/number/tag disagreement refuse', () => {
  const { args } = fixture();
  for (const change of [
    { activeVersion: id(19) },
    { uploadId: id(22) },
    { candidateInfo: { ...args.candidateInfo, number: 22 } },
    { candidateInfo: { ...args.candidateInfo, annotations: {} } },
  ])
    refuse(() => attestAcknowledgedCandidate({ ...args, ...change }));
});
test('receipt and errors do not expose provider metadata values', () => {
  const privateValue = 'fixture-private-value';
  const { before, candidate } = fixture();
  before[0].metadata.extra = privateValue;
  const pin = pinLatestOriginal(capture(before), id(20), before[0], operationTag);
  const args = {
    pin,
    afterPage: capture([candidate, ...before]),
    uploadAcknowledged: true,
    uploadId: id(21),
    candidateInfo: candidate,
    activeVersion: id(20),
  };
  assert.equal(JSON.stringify(attestAcknowledgedCandidate(args)).includes(privateValue), false);
  args.activeVersion = privateValue;
  refuse(() => attestAcknowledgedCandidate(args));
});
test('oversized or deeply nested unknown provider metadata refuses', () => {
  refuse(() => capture([{ ...entry(20), unknown: 'x'.repeat(65536) }]));
  let unknown = {};
  for (let i = 0; i < 18; i++) unknown = { unknown };
  refuse(() => capture([{ ...entry(20), unknown }]));
});
