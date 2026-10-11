import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hydratePagedRasterImage } from '../import/paged-raster-hydration';
import { previewPhotoEngravingInWorker } from './photo-engraving-preview-client';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';
import { photoPreviewFixture } from './photo-engraving-preview.test-support';
import { initialPhotoEngravingDraft, type PhotoEngravingDraft } from './photo-engraving-settings';
import type { PhotoEngravingSession } from './photo-engraving-store';
import { usePhotoEngravingPreview } from './use-photo-engraving-preview';

vi.mock('../import/paged-raster-hydration', () => ({ hydratePagedRasterImage: vi.fn() }));
vi.mock('./photo-engraving-preview-client', () => ({ previewPhotoEngravingInWorker: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(hydratePagedRasterImage).mockImplementation(async (image) => image);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it('cancels old work, hides its result immediately and reuses hydrated pixels across edits', async () => {
  const session = owner();
  const draft = initialPhotoEngravingDraft(session.image, session.operation);
  let finishOld: ((result: PhotoEngravingPreviewResult) => void) | undefined;
  vi.mocked(previewPhotoEngravingInWorker).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  await render(session, draft);
  await advance();
  const oldSignal = vi.mocked(previewPhotoEngravingInWorker).mock.calls[0]?.[1];
  const next = { ...draft, gamma: 1.2 };
  await render(session, next);
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => finishOld?.({ kind: 'error', message: 'obsolete' }));
  expect(host.textContent).toBe('pending');
  vi.mocked(previewPhotoEngravingInWorker).mockResolvedValueOnce({
    kind: 'error',
    message: 'current',
  });
  await advance();
  expect(host.textContent).toBe('current');
  expect(hydratePagedRasterImage).toHaveBeenCalledTimes(1);
});

it('rejects an oversized source before reading or encoding paged pixels', async () => {
  const original = owner();
  const session = {
    ...original,
    image: { ...original.image, pixelWidth: 8192, pixelHeight: 4096 },
  };
  await render(session, initialPhotoEngravingDraft(session.image, session.operation));
  await advance();
  expect(host.textContent).toContain('Photo preview is unavailable at this size');
  expect(hydratePagedRasterImage).not.toHaveBeenCalled();
  expect(previewPhotoEngravingInWorker).not.toHaveBeenCalled();
});

it('cancels hydration when the owner changes and never submits those pixels to a worker', async () => {
  const session = owner();
  const draft = initialPhotoEngravingDraft(session.image, session.operation);
  let finish: (() => void) | undefined;
  vi.mocked(hydratePagedRasterImage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(session.image);
      }),
  );
  await render(session, draft);
  await advance();
  const signal = vi.mocked(hydratePagedRasterImage).mock.calls[0]?.[2];
  await render(session, draft, false);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish?.());
  expect(previewPhotoEngravingInWorker).not.toHaveBeenCalled();
  expect(host.textContent).toBe('pending');
});

it('hides a previously completed result immediately while the next draft is waiting', async () => {
  const session = owner();
  const draft = initialPhotoEngravingDraft(session.image, session.operation);
  vi.mocked(previewPhotoEngravingInWorker).mockResolvedValue({ kind: 'error', message: 'first' });
  await render(session, draft);
  await advance();
  expect(host.textContent).toBe('first');
  await render(session, { ...draft, brightness: 5 });
  expect(host.textContent).toBe('pending');
});

function owner(): PhotoEngravingSession {
  const fixture = photoPreviewFixture();
  return {
    sessionId: 'session',
    projectDocumentEpoch: 0,
    image: fixture.image,
    operation: fixture.layer,
    device: fixture.device,
    sceneObjects: fixture.sceneObjects,
  };
}

async function render(
  session: PhotoEngravingSession,
  draft: PhotoEngravingDraft,
  current = true,
): Promise<void> {
  await act(async () => root.render(<Harness session={session} draft={draft} current={current} />));
}

async function advance(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(160);
  });
}

function Harness(props: {
  readonly session: PhotoEngravingSession;
  readonly draft: PhotoEngravingDraft;
  readonly current: boolean;
}): JSX.Element {
  const result = usePhotoEngravingPreview(props.session, props.draft, props.current);
  return <output>{result?.kind === 'error' ? result.message : (result?.kind ?? 'pending')}</output>;
}
