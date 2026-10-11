import { expect, test } from './fixtures/kerfdesk-test';
import type { renderTextGeometry } from '../src/ui/text/render-text-geometry';
import type { loadFont } from '../src/ui/text/font-loader';
import type { prepareTextShaping } from '../src/io/text/prepare-text-shaping';
import type { encodeEmbeddedFont } from '../src/core/text/embedded-font';

test('loads the browser shaping engine and matches native multilingual text', async ({
  page,
}, testInfo) => {
  const wasmResponses: number[] = [];
  page.on('response', (response) => {
    if (/harfbuzz[^/]*\.wasm(?:\?|$)/.test(response.url())) wasmResponses.push(response.status());
  });
  await page.goto('/');
  await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
  const results = await page.evaluate(async () => {
    const renderUrl = '/src/ui/text/render-text-geometry.ts';
    const fontUrl = '/src/ui/text/font-loader.ts';
    const shapingUrl = '/src/io/text/prepare-text-shaping.ts';
    const { renderTextGeometry: render } = (await import(renderUrl)) as {
      renderTextGeometry: typeof renderTextGeometry;
    };
    const { loadFont: load } = (await import(fontUrl)) as { loadFont: typeof loadFont };
    const { prepareTextShaping: prepare } = (await import(shapingUrl)) as {
      prepareTextShaping: typeof prepareTextShaping;
    };
    const embeddedUrl = '/src/core/text/embedded-font.ts';
    const { encodeEmbeddedFont: encode } = (await import(embeddedUrl)) as {
      encodeEmbeddedFont: typeof encodeEmbeddedFont;
    };
    const arabicResponse = await fetch('/src/core/text/__fixtures__/NotoSansArabic-Regular.ttf');
    if (!arabicResponse.ok) throw new Error('Arabic fixture unavailable');
    const arabic = encode({
      key: 'shaping-test-arabic',
      fileName: 'NotoSansArabic-Regular.ttf',
      buffer: await arabicResponse.arrayBuffer(),
    });
    const report = document.createElement('div');
    report.id = 'shaping-reference';
    report.style.cssText =
      'position:absolute;inset:0;background:white;color:black;padding:20px;z-index:999999;min-height:100%;height:max-content';
    document.body.append(report);

    function canvas() {
      const element = document.createElement('canvas');
      // Rasterise at 4x to keep font hinting and a subpixel ink-origin shift
      // from dominating a comparison of otherwise identical vector geometry.
      element.width = 4000;
      element.height = 640;
      element.style.cssText = 'width:1000px;height:160px;display:block';
      return element;
    }
    function mask(element: HTMLCanvasElement) {
      const context = element.getContext('2d');
      if (context === null) throw new Error('Canvas unavailable');
      const pixels = context.getImageData(0, 0, element.width, element.height).data;
      let left = element.width,
        top = element.height,
        right = 0,
        bottom = 0;
      for (let y = 0; y < element.height; y += 1) {
        for (let x = 0; x < element.width; x += 1) {
          if ((pixels[(y * element.width + x) * 4 + 3] ?? 0) > 127) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        }
      }
      const width = right - left + 1,
        height = bottom - top + 1;
      const data = new Set<string>();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if ((pixels[((y + top) * element.width + x + left) * 4 + 3] ?? 0) > 127)
            data.add(`${x},${y}`);
        }
      }
      return data;
    }

    const results = [];
    for (const content of ['שלום עולם', 'ABC שלום 123', 'a\u0301 e\u0301 o\u0308', 'السَّلَامُ']) {
      const isArabic = content.startsWith('ا');
      const fontKey = isArabic ? arabic.key : 'tinos-regular';
      const embeddedFonts = isArabic ? [arabic] : undefined;
      const fontBuffer = await load(fontKey, embeddedFonts);
      const family = isArabic ? 'ShapingArabic' : 'ShapingTest';
      const face = new FontFace(family, fontBuffer);
      await face.load();
      document.fonts.add(face);
      const geometry = await render({
        fontKey,
        embeddedFonts,
        content,
        sizeMm: 80,
        alignment: 'left',
        lineHeight: 1.4,
        letterSpacing: 0,
        color: '#000000',
      });
      const shaped = await prepare(fontBuffer, content);
      if (shaped === undefined) throw new Error('Expected multilingual shaping');
      const actual = canvas(),
        reference = canvas();
      const context = actual.getContext('2d'),
        native = reference.getContext('2d');
      if (context === null || native === null) throw new Error('Canvas unavailable');
      context.scale(4, 4);
      context.translate(20, 20);
      context.beginPath();
      for (const path of geometry.paths) {
        for (const curve of path.curves ?? []) {
          context.moveTo(curve.start.x, curve.start.y);
          for (const segment of curve.segments) {
            if (segment.kind === 'line') context.lineTo(segment.to.x, segment.to.y);
            else if (segment.kind === 'cubic')
              context.bezierCurveTo(
                segment.control1.x,
                segment.control1.y,
                segment.control2.x,
                segment.control2.y,
                segment.to.x,
                segment.to.y,
              );
            else throw new Error('Unexpected text outline segment');
          }
          if (curve.closed) context.closePath();
        }
      }
      context.fill('nonzero');
      native.font = `320px ${family}`;
      native.fontKerning = 'normal';
      native.direction = isArabic || content.startsWith('ש') ? 'rtl' : 'ltr';
      native.textAlign = 'left';
      native.fillText(content, 80, 440);
      const a = mask(actual),
        b = mask(reference);
      const intersection = [...a].filter((pixel) => b.has(pixel)).length;
      const title = document.createElement('p');
      title.textContent = `${content} — KerfDesk outlines / Chrome native reference`;
      report.append(title, actual, reference);
      results.push({
        content,
        overlap: intersection / (a.size + b.size - intersection),
        advance: (shaped.line(0, content.length).advance * 80) / (isArabic ? 1000 : 2048),
        nativeAdvance: native.measureText(content).width / 4,
        curves: geometry.paths.flatMap((path) => path.curves ?? []).length,
        missing: geometry.missingCharacters ?? [],
      });
    }
    return results;
  });
  await page.screenshot({
    path: testInfo.outputPath('multilingual-native-reference.png'),
    fullPage: true,
  });
  await testInfo.attach('native-reference-metrics', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  expect(wasmResponses).toContain(200);
  for (const result of results) {
    // KerfDesk retains its existing opentype outline extraction. Its Tinos
    // curves differ slightly from Chrome's font rasteriser (also for Latin);
    // this bound detects ordering/mark failures without demanding pixel identity.
    expect(result.overlap, result.content).toBeGreaterThan(0.85);
    expect(result.advance, result.content).toBeCloseTo(result.nativeAdvance, 3);
    expect(result.curves).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
  }
});
