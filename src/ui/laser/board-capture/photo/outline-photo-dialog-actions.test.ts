import { beforeEach, expect, it, vi } from 'vitest';
import { loadImageAsRawData } from '../../../trace/image-loader';
import { loadOutlinePhoto } from './outline-photo-dialog-actions';
import {
  INITIAL_OUTLINE_PHOTO_SESSION,
  outlinePhotoSessionReducer,
  type LoadedImage,
  type OutlinePhotoDispatch,
} from './use-outline-photo-session';

vi.mock('../../../trace/image-loader', () => ({ loadImageAsRawData: vi.fn() }));

function deferred() {
  let resolve!: (image: LoadedImage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<LoadedImage>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function session() {
  let state = INITIAL_OUTLINE_PHOTO_SESSION;
  const dispatch: OutlinePhotoDispatch = (action) => {
    state = outlinePhotoSessionReducer(state, action);
  };
  return { dispatch, state: () => state };
}

const oldFile = new File(['old'], 'old.png');
const newFile = new File(['new'], 'new.png');
const image = (width: number): LoadedImage => ({
  width,
  height: 10,
  data: new Uint8ClampedArray(width * 10 * 4),
});

beforeEach(() => vi.mocked(loadImageAsRawData).mockReset());

it.each(['success', 'failure'] as const)(
  'ignores stale decode %s after a newer photo and edits',
  async (outcome) => {
    const old = deferred();
    const latest = deferred();
    vi.mocked(loadImageAsRawData)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const s = session();
    const first = loadOutlinePhoto(oldFile, s.dispatch);
    const second = loadOutlinePhoto(newFile, s.dispatch);
    latest.resolve(image(20));
    await second;
    s.dispatch({ type: 'point-added', point: { x: 1, y: 1 } });
    s.dispatch({ type: 'width-edited', value: '150' });
    const edited = s.state();
    if (outcome === 'success') old.resolve(image(40));
    else old.reject(new Error('Stale decode failure'));
    await first;
    expect(s.state()).toBe(edited);
    expect(s.state().image?.width).toBe(20);
  },
);

it('keeps separate photo sessions independent and a cancelled picker does not supersede a load', async () => {
  const a = deferred();
  const b = deferred();
  vi.mocked(loadImageAsRawData).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const first = session();
  const second = session();
  const pendingA = loadOutlinePhoto(oldFile, first.dispatch);
  const pendingB = loadOutlinePhoto(newFile, second.dispatch);
  await loadOutlinePhoto(undefined, first.dispatch);
  b.resolve(image(20));
  a.resolve(image(40));
  await Promise.all([pendingA, pendingB]);
  expect(first.state().image?.width).toBe(40);
  expect(second.state().image?.width).toBe(20);
});

it('shows the current failure and never falls back to a superseded successful decode', async () => {
  const old = deferred();
  const latest = deferred();
  vi.mocked(loadImageAsRawData)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(latest.promise);
  const s = session();
  const first = loadOutlinePhoto(oldFile, s.dispatch);
  const second = loadOutlinePhoto(newFile, s.dispatch);
  latest.reject(new Error('Current decode failure'));
  await second;
  old.resolve(image(40));
  await first;
  expect(s.state().image).toBeNull();
  expect(s.state().error).toBe('Current decode failure');
});
