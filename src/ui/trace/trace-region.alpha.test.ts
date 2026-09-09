import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alphaForegroundAt,
  alphaRgbDetail,
  DETAIL_ALPHA_REGION,
  whiteAlphaPatch,
  WHITE_ALPHA_REGION,
} from '../../__fixtures__/trace-alpha';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import * as cooperative from './cooperative-trace-runner';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { resolveTraceCommitResult } from './trace-commit-result';
import { loadImageAsRawData } from './image-loader';

vi.mock('./image-loader', () => ({ loadImageAsRawData: vi.fn() }));

beforeEach(() => vi.stubGlobal('Worker', undefined));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const alphaOptions: TraceOptions = Object.freeze({
  ...TRACE_PRESETS['Line Art']!,
  traceTransparency: true,
});
const sharpAlpha: TraceOptions = Object.freeze({
  ...TRACE_PRESETS['Sharp']!,
  traceTransparency: true,
});

describe('full-source alpha through real cooperative region tracing', () => {
  it('keeps the white patch in full, exactly opaque Crop and transparent-margin Crop', async () => {
    const image = whiteAlphaPatch();
    const sourceBytes = image.data.slice();
    const runner = vi.spyOn(cooperative, 'createCooperativeTraceRunner');
    const regions = [null, WHITE_ALPHA_REGION, { x: 44, y: 44, width: 22, height: 22 }];
    const results = [];
    for (const region of regions) {
      results.push(await traceImageWithBoundaryMode(image, alphaOptions, region, 'crop'));
    }
    // The actual generator/cooperative route was selected; no tracer or result is mocked.
    expect(runner).toHaveBeenCalled();
    expect(image.data).toEqual(sourceBytes);
    expect(alphaOptions).toEqual({ ...TRACE_PRESETS['Line Art'], traceTransparency: true });
    for (const result of results) {
      expect(result).toMatchObject({ width: 128, height: 128 });
      expect(alphaForegroundAt(result.paths, 55, 55)).toBe(true);
      expect(alphaForegroundAt(result.paths, 43, 55)).toBe(false);
      expect(alphaForegroundAt(result.paths, 67, 55)).toBe(false);
      // Distinct working scales may move a contour by a subpixel, never to the crop origin.
      expect(Math.abs(result.bounds.minX - 45)).toBeLessThan(0.75);
      expect(Math.abs(result.bounds.maxX - 65)).toBeLessThan(0.75);
    }
  });

  it('does not invent an even-odd hole from RGB inside an opaque Enhance region', async () => {
    const image = alphaRgbDetail();
    const before = image.data.slice();
    const full = await traceImageWithBoundaryMode(image, sharpAlpha, null, 'crop');
    const enhanced = await traceImageWithBoundaryMode(
      image,
      sharpAlpha,
      DETAIL_ALPHA_REGION,
      'enhance',
    );
    const white = await traceImageWithBoundaryMode(
      alphaRgbDetail('white'),
      sharpAlpha,
      DETAIL_ALPHA_REGION,
      'enhance',
    );
    expect(alphaForegroundAt(full.paths, 32, 32)).toBe(true);
    expect(alphaForegroundAt(enhanced.paths, 32, 32)).toBe(true);
    expect(enhanced).toEqual(white);
    expect(enhanced.paths.flatMap((path) => path.polylines)).toEqual(
      full.paths.flatMap((path) => path.polylines),
    );
    expect(image.data).toEqual(before);
  });

  it.each(['crop', 'enhance'] as const)(
    'keeps an originally opaque source on the luminance fallback in %s',
    async (mode) => {
      const image = alphaRgbDetail('opaque');
      const requestedAlpha = await traceImageWithBoundaryMode(
        image,
        sharpAlpha,
        DETAIL_ALPHA_REGION,
        mode,
      );
      const luminance = await traceImageWithBoundaryMode(
        image,
        { ...sharpAlpha, traceTransparency: false },
        DETAIL_ALPHA_REGION,
        mode,
      );
      expect(requestedAlpha).toEqual(luminance);
      expect(alphaForegroundAt(requestedAlpha.paths, 32, 32)).toBe(true);
      expect(alphaForegroundAt(requestedAlpha.paths, 21, 21)).toBe(false);
    },
  );

  it('ignores RGB detail when the entire source has uniform partial alpha', async () => {
    const detail = alphaRgbDetail();
    const white = alphaRgbDetail('white');
    for (let i = 3; i < detail.data.length; i += 4) {
      detail.data[i] = 127;
      white.data[i] = 127;
    }
    for (const mode of ['crop', 'enhance'] as const) {
      const result = await traceImageWithBoundaryMode(
        detail,
        sharpAlpha,
        DETAIL_ALPHA_REGION,
        mode,
      );
      const reference = await traceImageWithBoundaryMode(
        white,
        sharpAlpha,
        DETAIL_ALPHA_REGION,
        mode,
      );
      expect(result).toEqual(reference);
      expect(alphaForegroundAt(result.paths, 32, 32)).toBe(true);
      expect(alphaForegroundAt(result.paths, 21, 21)).toBe(true);
    }
    expect(await traceImageWithBoundaryMode(detail, sharpAlpha, null, 'crop')).toEqual(
      await traceImageWithBoundaryMode(white, sharpAlpha, null, 'crop'),
    );
  });

  it.each([0, 126, 127, 255])(
    'retains alpha %i threshold meaning after a tight Crop',
    async (alpha) => {
      const image = whiteAlphaPatch(alpha);
      const full = await traceImageWithBoundaryMode(image, sharpAlpha, null, 'crop');
      const cropped = await traceImageWithBoundaryMode(
        image,
        sharpAlpha,
        WHITE_ALPHA_REGION,
        'crop',
      );
      expect(alphaForegroundAt(full.paths, 55, 55)).toBe(alpha >= 127);
      expect(alphaForegroundAt(cropped.paths, 55, 55)).toBe(alpha >= 127);
    },
  );

  it('retains a real transparent hole in full, Crop and Enhance results', async () => {
    const image = alphaRgbDetail('hole');
    for (const mode of ['crop', 'enhance'] as const) {
      const result = await traceImageWithBoundaryMode(image, sharpAlpha, DETAIL_ALPHA_REGION, mode);
      expect(alphaForegroundAt(result.paths, 21, 21)).toBe(true);
      expect(alphaForegroundAt(result.paths, 32, 32)).toBe(false);
    }
    const full = await traceImageWithBoundaryMode(image, sharpAlpha, null, 'crop');
    expect(alphaForegroundAt(full.paths, 21, 21)).toBe(true);
    expect(alphaForegroundAt(full.paths, 32, 32)).toBe(false);
  });

  it.each(['crop', 'enhance'] as const)(
    'matches prepared and recomputed %s without mutating request identity',
    async (boundaryMode) => {
      const image = alphaRgbDetail();
      const request = Object.freeze({
        file: new File(['alpha fixture'], 'alpha.png'),
        options: sharpAlpha,
        boundary: DETAIL_ALPHA_REGION,
        boundaryMode,
      });
      vi.mocked(loadImageAsRawData).mockResolvedValue(image);
      const result = await traceImageWithBoundaryMode(
        image,
        request.options,
        request.boundary,
        boundaryMode,
      );
      const preparedTrace = { request, result };
      const prepared = await resolveTraceCommitResult({ ...request, preparedTrace });
      const recomputed = await resolveTraceCommitResult({
        ...request,
        options: { ...sharpAlpha },
        preparedTrace,
      });
      expect(prepared).toBe(result);
      expect(recomputed).toEqual(prepared);
      expect(alphaForegroundAt(recomputed.paths, 32, 32)).toBe(true);
      expect(request.options).toBe(sharpAlpha);
      expect(request.options).toEqual({ ...TRACE_PRESETS['Sharp'], traceTransparency: true });
    },
  );
});
