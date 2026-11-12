// The camera-moved check reads its view reference more than once per check
// (rolling audit v14 Z1 follow-up). The reference is decoded once per stored
// value, and a newly saved reference is read afresh.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { loadViewReference, saveViewReference } from './view-reference';

const record = savedCameraModel();

function thumbnail(value: number) {
  return { width: 4, height: 2, data: new Uint8Array(8).fill(value) };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('decodes a stored reference once, however often it is read', () => {
  saveViewReference(record, thumbnail(7));
  const decode = vi.spyOn(globalThis, 'atob');
  const first = loadViewReference(record);
  const second = loadViewReference(record);
  expect(first?.data).toEqual(new Uint8Array(8).fill(7));
  expect(second).toBe(first);
  expect(decode).toHaveBeenCalledTimes(1);
});

it('reads a newly saved reference, and none once it is gone', () => {
  saveViewReference(record, thumbnail(7));
  expect(loadViewReference(record)?.data[0]).toBe(7);
  saveViewReference(record, thumbnail(9));
  expect(loadViewReference(record)?.data[0]).toBe(9);
  localStorage.clear();
  expect(loadViewReference(record)).toBeNull();
});
