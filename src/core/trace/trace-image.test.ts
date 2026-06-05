import { describe, expect, it, vi } from 'vitest';
import {
  buildImageTracerOptions,
  DEFAULT_TRACE_OPTIONS,
  preprocessForTrace,
  thresholdBandToMonochrome,
  thresholdToMonochrome,
  traceImageToSvgString,
  TRACE_PRESETS,
} from './trace-image';
import { lightBurnTraceSettingsToPotraceParams } from './potrace-params';

type Fixture = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
};

// Build a tiny synthetic raster: a black square (8×8) centered in a
// white 16×16 image. RGBA uint8 layout matches what canvas.getImageData
// returns; imagetracerjs doesn't care if the buffer came from a real
// canvas or a fixture as long as the shape matches.
function blackSquareOnWhite(): Fixture {
  const W = 16;
  const H = 16;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const inSquare = x >= 4 && x < 12 && y >= 4 && y < 12;
      const v = inSquare ? 0 : 255;
      data[i + 0] = v; // r
      data[i + 1] = v; // g
      data[i + 2] = v; // b
      data[i + 3] = 255; // a
    }
  }
  return { width: W, height: H, data };
}

// Programmatic "logo-like" fixture used by F-4's regression test.
// 128×128 image with:
//   - a filled black circle (radius 35) at the center, with 1-px AA ring
//   - a centered horizontal stripe (text baseline stand-in) that crosses
//     the circle, also with AA edges
// Reproduces the structural pattern of a typical rasterized logo:
// large continuous filled regions with anti-aliased edges. If the
// Line Art preset regresses, the AA ring becomes speckle and the
// trace's polyline count + max-length both blow out.
function buildLogoLikeFixture(): Fixture {
  const W = 128;
  const H = 128;
  const data = new Uint8ClampedArray(W * H * 4);
  const cx = W / 2;
  const cy = H / 2;
  const r = 35;
  const stripeTop = 60;
  const stripeBottom = 68;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const distToCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      // Circle: solid black inside r-1, AA ring between r-1 and r+1
      let v = 255;
      const circleEdge = Math.abs(distToCenter - r);
      if (distToCenter < r - 1) v = 0;
      else if (circleEdge < 1) v = 128; // AA gray
      // Stripe: overlays whatever was there. Inside stripe = black,
      // with 0.5-px AA on the top/bottom.
      if (y >= stripeTop && y < stripeBottom) v = 0;
      else if (y === stripeTop - 1 || y === stripeBottom) v = Math.min(v, 128);
      const i = (y * W + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

describe('traceImageToSvgString', () => {
  it('retries the imagetracer dynamic import after a transient chunk failure', async () => {
    vi.resetModules();
    (globalThis as { __lfImagetracerSvgAttempts?: number }).__lfImagetracerSvgAttempts = 0;
    vi.doMock('imagetracerjs', () => {
      const state = globalThis as { __lfImagetracerSvgAttempts?: number };
      const attempts = (state.__lfImagetracerSvgAttempts ?? 0) + 1;
      state.__lfImagetracerSvgAttempts = attempts;
      if (attempts === 1) throw new Error('chunk failed');
      return { default: { imagedataToSVG: () => '<svg data-retry="ok"></svg>' } };
    });
    try {
      const fresh = await import('./trace-image');
      const image = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) };

      await expect(fresh.traceImageToSvgString(image, fresh.DEFAULT_TRACE_OPTIONS)).rejects.toThrow(
        /chunk failed|mocking a module/,
      );
      await expect(fresh.traceImageToSvgString(image, fresh.DEFAULT_TRACE_OPTIONS)).resolves.toBe(
        '<svg data-retry="ok"></svg>',
      );
    } finally {
      vi.doUnmock('imagetracerjs');
      vi.resetModules();
      delete (globalThis as { __lfImagetracerSvgAttempts?: number }).__lfImagetracerSvgAttempts;
    }
  });

  it('returns a string starting with <svg', async () => {
    const svg = await traceImageToSvgString(blackSquareOnWhite());
    expect(typeof svg).toBe('string');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('produces a non-trivially-sized SVG (more than just the root tag)', async () => {
    const svg = await traceImageToSvgString(blackSquareOnWhite());
    // A black-on-white traced output should contain at least one
    // <path>, <polygon>, or <rect> element with coordinates.
    expect(svg.length).toBeGreaterThan(50);
    expect(svg).toMatch(/<(path|polygon|polyline|rect)/);
  });

  it('fixed-palette mode produces a 2-color output regardless of input richness', async () => {
    // The "Line Art" preset uses a fixed [white, black] palette.
    // Even on a noisy 4-color fixture it must yield exactly two
    // color layers in the SVG (clean ink + background).
    const W = 16;
    const H = 16;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i += 1) {
      // Stripe the image into 4 grays so default quantization would
      // produce 4 layers.
      const v = (Math.floor(i / 4) % 4) * 80;
      data[i * 4 + 0] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    const svg = await traceImageToSvgString(
      { width: W, height: H, data },
      {
        ...DEFAULT_TRACE_OPTIONS,
        fixedPalette: ['#ffffff', '#000000'],
      },
    );
    // imagetracerjs emits <g> per color; count distinct fill colors
    // in the output. With a fixed [white, black] palette, no other
    // fill values should appear.
    const fills = Array.from(svg.matchAll(/fill="rgb\(([^)]+)\)"/g)).map((m) => m[1]);
    const uniqueFills = new Set(fills);
    expect(uniqueFills.size).toBeLessThanOrEqual(2);
  });

  it('respects numberOfColors — 2 colors produces fewer/different layers than 8', async () => {
    const two = await traceImageToSvgString(blackSquareOnWhite(), {
      ...DEFAULT_TRACE_OPTIONS,
      numberOfColors: 2,
    });
    const eight = await traceImageToSvgString(blackSquareOnWhite(), {
      ...DEFAULT_TRACE_OPTIONS,
      numberOfColors: 8,
    });
    // Different color quantization → different SVG output. We don't
    // assert one is strictly larger (small fixtures can flip), just
    // that the option changes the output meaningfully.
    expect(two).not.toBe(eight);
  });

  it('end-to-end: trace + parseSvg produces drawable ColoredPath polylines', async () => {
    // Phase E full pipeline check. The dialog runs exactly this
    // chain: ImageData → traceImageToSvgString → parseSvg → object
    // with `paths: ColoredPath[]`. If anything in that chain
    // regresses, this test catches it.
    const { parseSvg } = await import('../../io/svg/parse-svg');
    const svg = await traceImageToSvgString(blackSquareOnWhite());
    const result = parseSvg({ svgText: svg, id: 'test', source: 'fixture.png' });
    expect(result.object).not.toBeNull();
    if (result.object !== null) {
      expect(result.object.paths.length).toBeGreaterThan(0);
      // At least one polyline with at least 2 points (otherwise
      // there's nothing to cut).
      const anyPolyline = result.object.paths.some((p) =>
        p.polylines.some((pl) => pl.points.length >= 2),
      );
      expect(anyPolyline).toBe(true);
    }
  });

  it('thresholdToMonochrome turns AA grays into pure black or white', () => {
    // 4×1 image with luminance values: 0 (black), 100 (dark gray),
    // 180 (light gray), 255 (white). With threshold 128, the first
    // two become black, the last two become white.
    const data = new Uint8ClampedArray([
      0,
      0,
      0,
      255, // black
      100,
      100,
      100,
      255, // dark gray — below threshold
      180,
      180,
      180,
      255, // light gray — above threshold
      255,
      255,
      255,
      255, // white
    ]);
    const result = thresholdToMonochrome({ width: 4, height: 1, data }, 128);
    expect(Array.from(result.data)).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
  });

  it('thresholdToMonochrome is pure — does not mutate the input', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    const original = new Uint8ClampedArray(data);
    thresholdToMonochrome({ width: 1, height: 1, data }, 128);
    expect(Array.from(data)).toEqual(Array.from(original));
  });

  it('thresholdBandToMonochrome matches LightBurn Cutoff/Threshold inclusivity', () => {
    // LightBurn traces brightness values in the inclusive range
    // Cutoff..Threshold. With Cutoff=10 and Threshold=128, black (0)
    // is excluded, 10/64/128 are ink, and 129/255 are excluded.
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 10, 10, 10, 255, 64, 64, 64, 255, 128, 128, 128, 255, 129, 129, 129, 255, 255,
      255, 255, 255,
    ]);

    const result = thresholdBandToMonochrome({ width: 6, height: 1, data }, 10, 128);

    expect(Array.from(result.data)).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255,
      255, 255,
    ]);
  });

  it('preprocessForTrace applies the LightBurn brightness band when cutoffLuma is set', () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 32, 32, 32, 255, 128, 128, 128, 255, 180, 180, 180, 255,
    ]);

    const result = preprocessForTrace(
      { width: 4, height: 1, data },
      {
        ...DEFAULT_TRACE_OPTIONS,
        cutoffLuma: 32,
        thresholdLuma: 128,
      },
    );

    expect(Array.from(result.data)).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]);
  });

  it('Line Art preset uses LightBurn default Cutoff/Threshold range', () => {
    const lineArt = TRACE_PRESETS['Line Art'];

    expect(lineArt?.cutoffLuma).toBe(0);
    expect(lineArt?.thresholdLuma).toBe(128);
    expect(lineArt?.ignoreLessThanPixels).toBe(2);
    expect(lineArt?.smoothness).toBe(1);
    expect(lineArt?.optimize).toBe(0.2);
    expect(lightBurnTraceSettingsToPotraceParams(lineArt)).toMatchObject({
      turdSize: 2,
      alphaMax: 1,
      optCurve: true,
      optTolerance: 0.2,
    });
    expect(lineArt?.useOtsuThreshold).toBeUndefined();
  });

  it('Line Art preset: traces an AA-heavy fixture without spurious dots', async () => {
    // Build a 32×32 fixture: a 12×12 black square at (10,10) with
    // gradient-shaded AA borders 1 pixel wide. Without pre-threshold
    // these borders produce edge speckle in the trace; with the
    // Line Art preset they should collapse to a single solid square
    // outline (one or two contours, no dot clusters).
    const W = 32;
    const H = 32;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = x - 16;
        const dy = y - 16;
        const distToCenter = Math.max(Math.abs(dx), Math.abs(dy));
        let v: number;
        if (distToCenter < 5)
          v = 0; // pure black square center
        else if (distToCenter > 8)
          v = 255; // pure white outside
        else v = 128; // AA gray on the border ring
        const i = (y * W + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const svg = await traceImageToSvgString(
      { width: W, height: H, data },
      {
        ...DEFAULT_TRACE_OPTIONS,
        fixedPalette: ['#ffffff', '#000000'],
        thresholdLuma: 128,
        pathOmit: 16,
      },
    );
    // Without pre-threshold + pathOmit, that AA ring would produce
    // dozens of tiny disconnected paths. With both on, count of
    // <path> elements should be small (≤ 4: one or two solid
    // contours + maybe background).
    const pathCount = (svg.match(/<path/g) ?? []).length;
    expect(pathCount).toBeLessThanOrEqual(4);
  });

  it('logo-like fixture: traces to continuous contours (regression for F-4)', async () => {
    // Programmatic stand-in for the user's Lekker Kuier logo —
    // shapes with anti-aliased borders, similar in structure to
    // any real rasterized logo. Tests that the Line Art preset
    // (pre-threshold + fixed palette + pathOmit 16) yields
    // continuous contours, NOT a swarm of small dots.
    //
    // Continuity assertions: a real continuous outline has many
    // points after imagetracer's simplification (≥ 20 for any
    // shape larger than a glyph). The actual failure mode of the
    // pre-fix code was dozens of 2-3-point polylines (speckle).
    // We check BOTH: longest is meaningfully long AND total count
    // is small. If either lever flips, the bug is back.
    const image = buildLogoLikeFixture();
    const { parseSvg } = await import('../../io/svg/parse-svg');
    const svg = await traceImageToSvgString(image, {
      ...DEFAULT_TRACE_OPTIONS,
      fixedPalette: ['#ffffff', '#000000'],
      thresholdLuma: 128,
      pathOmit: 16,
      lineFilter: true,
    });
    const result = parseSvg({ svgText: svg, id: 'fixture', source: 'logo-like.png' });
    expect(result.object).not.toBeNull();
    if (result.object === null) return;
    const allPolylines = result.object.paths.flatMap((p) => p.polylines);
    const longest = Math.max(...allPolylines.map((pl) => pl.points.length));
    expect(allPolylines.length).toBeLessThanOrEqual(10);
    expect(longest).toBeGreaterThanOrEqual(20);
  });

  it('sub-50px logo retains small features under Line Art preset (MIT-T3)', async () => {
    // Audit finding MIT-T3: our Line Art preset uses pathOmit=16, twice
    // imagetracerjs's default 8. For a tiny logo (< 50 px on the long
    // edge — typical favicon / small badge case) the aggressive omit
    // could eat dots, periods, or thin strokes. This fixture is a
    // 40×40 image carrying:
    //   - A solid 24×24 square (the "body" — a large feature)
    //   - A 4×4 black dot in the corner (the "small feature" to preserve)
    // Both are well above the 16-point omit threshold (a 4×4 square's
    // perimeter has 16 contour points, and the threshold actually counts
    // sample points after curve-fitting which is usually more), so the
    // dot must survive. If a future preset tweak drops it, this test
    // catches the regression.
    const W = 40;
    const H = 40;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const inBigSquare = x >= 4 && x < 28 && y >= 4 && y < 28;
        const inDot = x >= 32 && x < 36 && y >= 32 && y < 36;
        const v = inBigSquare || inDot ? 0 : 255;
        const i = (y * W + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const { parseSvg } = await import('../../io/svg/parse-svg');
    const svg = await traceImageToSvgString(
      { width: W, height: H, data },
      {
        ...DEFAULT_TRACE_OPTIONS,
        fixedPalette: ['#ffffff', '#000000'],
        thresholdLuma: 128,
        pathOmit: 16,
        lineFilter: true,
      },
    );
    const result = parseSvg({ svgText: svg, id: 't3', source: 'tiny.png' });
    expect(result.object).not.toBeNull();
    if (result.object === null) return;
    // Look for ANY polyline whose bounding-box centre lies inside the
    // expected dot region (32..36 in both axes). The dot is small —
    // we don't care about its exact point count, just that some
    // polyline exists there.
    const allPolylines = result.object.paths.flatMap((p) => p.polylines);
    const dotPresent = allPolylines.some((pl) => {
      if (pl.points.length === 0) return false;
      const cx = pl.points.reduce((s, p) => s + p.x, 0) / pl.points.length;
      const cy = pl.points.reduce((s, p) => s + p.y, 0) / pl.points.length;
      return cx >= 30 && cx <= 38 && cy >= 30 && cy <= 38;
    });
    expect(dotPresent).toBe(true);
  });

  it('rightangleenhance is always false (regression — LF1 audit)', () => {
    // imagetracerjs's `rightangleenhance` defaults to TRUE, which forces
    // traced edges toward 90° angles and ruins organic curves. LF1's
    // settings audit caught this; we now always set it false. A future
    // refactor that drops the explicit setting falls back to imagetracerjs's
    // default and silently regresses image quality. This test pins the
    // override.
    for (const presetName of Object.keys(TRACE_PRESETS)) {
      const preset = TRACE_PRESETS[presetName];
      if (preset === undefined) continue;
      const opts = buildImageTracerOptions(preset);
      expect(opts['rightangleenhance']).toBe(false);
    }
  });

  it('colorsampling is 0 ONLY when a fixed palette is set', () => {
    // colorsampling=0 disables imagetracerjs's color quantization
    // entirely. Correct for 2-colour engraving (Line Art / Smooth /
    // Sharp where we force the palette ourselves) — wrong for
    // multi-colour (Detailed / Photo, which need adaptive quant to
    // produce >2 layers). Pin both directions of this conditional.
    const withPalette = buildImageTracerOptions({
      ...DEFAULT_TRACE_OPTIONS,
      fixedPalette: ['#ffffff', '#000000'],
    });
    expect(withPalette['colorsampling']).toBe(0);

    const noPalette = buildImageTracerOptions(DEFAULT_TRACE_OPTIONS);
    expect(noPalette['colorsampling']).toBeUndefined();
  });

  it('handles a fully-uniform image without throwing', async () => {
    // All-white 8×8 — nothing to trace. Should still produce a valid
    // SVG string (probably empty or just the root tag).
    const W = 8;
    const H = 8;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i + 0] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    await expect(traceImageToSvgString({ width: W, height: H, data })).resolves.not.toThrow();
  });
});
