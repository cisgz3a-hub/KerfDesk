import { afterEach, expect, it, vi } from 'vitest';
import { computePhotoEngravingPreview } from './photo-engraving-preview';
import { photoPreviewFixture } from './photo-engraving-preview.test-support';
import type {
  PhotoEngravingPreviewWorkerRequest,
  PhotoEngravingPreviewWorkerResponse,
} from './photo-engraving-preview-worker-protocol';

afterEach(() => vi.unstubAllGlobals());

it('the worker transfers only bounded display pixels from the real compiled grid', async () => {
  const workerSelf = {
    onmessage: null as ((event: MessageEvent<PhotoEngravingPreviewWorkerRequest>) => void) | null,
    postMessage:
      vi.fn<(response: PhotoEngravingPreviewWorkerResponse, transfers: Transferable[]) => void>(),
  };
  vi.stubGlobal('self', workerSelf);
  await import('./photo-engraving-preview-worker');
  const input = photoPreviewFixture();
  const request = {
    id: 7,
    input: { ...input, layer: { ...input.layer, linesPerMm: 10 } },
    maxEdge: 16,
  };
  if (workerSelf.onmessage === null) throw new Error('Missing worker handler');
  workerSelf.onmessage({
    data: structuredClone(request),
  } as MessageEvent<PhotoEngravingPreviewWorkerRequest>);
  const [response, transfers] = workerSelf.postMessage.mock.calls[0] ?? [];
  expect(response?.id).toBe(7);
  expect(response?.result).toEqual(computePhotoEngravingPreview(request.input, 16));
  if (response?.result.kind !== 'ok') throw new Error('Expected success');
  expect(response.result.sourceWidth).toBe(80);
  expect(response.result.width).toBe(16);
  expect(transfers).toEqual([response.result.rgba.buffer]);
  expect(response.result.rgba.byteLength).toBe(16 * 8 * 4);
});
