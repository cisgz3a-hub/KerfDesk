import { describe, expect, it } from 'vitest';
import type { TraceState } from './outline-photo-rectify';
import {
  INITIAL_OUTLINE_PHOTO_SESSION,
  outlinePhotoSessionReducer,
  type OutlinePhotoSession,
} from './use-outline-photo-session';

const IMAGE = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
const TRACE: TraceState = {
  toMm: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  region: { x: 0, y: 0, width: 100, height: 80 },
  pixelsPerMm: 2,
  rectified: IMAGE,
  coarse: false,
};
const OUTLINE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 },
];

function tracedState(): OutlinePhotoSession {
  return {
    ...INITIAL_OUTLINE_PHOTO_SESSION,
    image: IMAGE,
    corners: OUTLINE,
    trace: TRACE,
    outline: OUTLINE,
    anchors: [0, 1, 2, 3],
    firstAnchor: 1,
    width: '100',
    height: '80',
    partial: true,
    error: 'old error',
    anchorHint: 'old hint',
  };
}

describe('outlinePhotoSessionReducer', () => {
  it('resets the complete workflow when a new photo loads', () => {
    const next = outlinePhotoSessionReducer(tracedState(), {
      type: 'photo-loaded',
      image: { ...IMAGE, width: 3 },
    });
    expect(next).toMatchObject({
      corners: [],
      trace: null,
      outline: null,
      anchors: [],
      firstAnchor: 0,
      width: '',
      height: '',
      partial: false,
      error: null,
      anchorHint: null,
      busy: false,
    });
    expect(next.image?.width).toBe(3);
  });

  it.each([
    { type: 'reference-changed' as const, reference: 'letter' as const },
    { type: 'custom-size-changed' as const, axis: 'width' as const, value: '220' },
  ])('resets trace results for $type while retaining corner taps', (action) => {
    const next = outlinePhotoSessionReducer(tracedState(), action);
    expect(next.corners).toEqual(OUTLINE);
    expect(next).toMatchObject({
      trace: null,
      outline: null,
      anchors: [],
      width: '',
      height: '',
      partial: false,
    });
  });

  it('clear corners also clears all trace results', () => {
    const next = outlinePhotoSessionReducer(tracedState(), { type: 'clear-corners' });
    expect(next.corners).toEqual([]);
    expect(next.trace).toBeNull();
    expect(next.outline).toBeNull();
  });

  it('adds at most four reference corners', () => {
    let state = INITIAL_OUTLINE_PHOTO_SESSION;
    for (let index = 0; index < 5; index += 1) {
      state = outlinePhotoSessionReducer(state, {
        type: 'corner-added',
        point: { x: index, y: index },
      });
    }
    expect(state.corners).toHaveLength(4);
  });

  it('tracks busy labels and errors explicitly', () => {
    const busy = outlinePhotoSessionReducer(INITIAL_OUTLINE_PHOTO_SESSION, {
      type: 'busy-start',
      label: 'Straightening photo…',
    });
    expect(busy).toMatchObject({ busy: true, busyLabel: 'Straightening photo…' });
    const failed = outlinePhotoSessionReducer(busy, { type: 'error', error: 'No board' });
    expect(failed.error).toBe('No board');
    expect(outlinePhotoSessionReducer(failed, { type: 'busy-end' })).toMatchObject({
      busy: false,
      busyLabel: '',
    });
  });

  it('stores a rectified trace and clears any prior board tap', () => {
    const next = outlinePhotoSessionReducer(tracedState(), {
      type: 'trace-ready',
      trace: TRACE,
    });
    expect(next.trace).toBe(TRACE);
    expect(next.outline).toBeNull();
    expect(next.anchors).toEqual([]);
    expect(next.partial).toBe(false);
  });

  it('stores traced geometry and supports size and first-anchor edits', () => {
    const traced = outlinePhotoSessionReducer(INITIAL_OUTLINE_PHOTO_SESSION, {
      type: 'traced',
      outline: OUTLINE,
      anchors: [0, 1, 2, 3],
      firstAnchor: 3,
      width: '100.0',
      height: '80.0',
      partial: true,
    });
    const width = outlinePhotoSessionReducer(traced, { type: 'width-edited', value: '120' });
    const height = outlinePhotoSessionReducer(width, { type: 'height-edited', value: '90' });
    const first = outlinePhotoSessionReducer(height, {
      type: 'first-anchor-selected',
      index: 2,
    });
    expect(first).toMatchObject({ width: '120', height: '90', firstAnchor: 2, partial: true });
  });

  it('retap clears the outline but preserves the rectified trace', () => {
    const next = outlinePhotoSessionReducer(tracedState(), { type: 'retap-board' });
    expect(next.trace).toBe(TRACE);
    expect(next).toMatchObject({
      outline: null,
      anchors: [],
      width: '',
      height: '',
      partial: false,
    });
  });

  it('re-picks the default first anchor when an anchor toggle removes it', () => {
    const next = outlinePhotoSessionReducer(tracedState(), {
      type: 'anchors-changed',
      anchors: [0, 2, 3],
    });
    expect(next.firstAnchor).toBe(3);
  });

  it('stores an anchor-limit hint', () => {
    const next = outlinePhotoSessionReducer(INITIAL_OUTLINE_PHOTO_SESSION, {
      type: 'anchor-hint',
      hint: 'Choose between 2 and 6 anchors.',
    });
    expect(next.anchorHint).toContain('2 and 6');
  });
});
