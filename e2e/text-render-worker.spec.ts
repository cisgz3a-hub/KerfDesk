import { expect, test } from './fixtures/kerfdesk-test';
import type { encodeEmbeddedFont } from '../src/core/text/embedded-font';
import type { renderTextGeometry } from '../src/ui/text/render-text-geometry';
import type { createTextWorkerSession } from '../src/ui/text/text-worker-session';

// ADR-631: canvas text lays out in a module worker, HarfBuzz WASM included,
// and returns exactly what the UI thread would have drawn.
test('lays canvas text out in the text worker, identical to the UI thread', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const sessionUrl = '/src/ui/text/text-worker-session.ts';
    const renderUrl = '/src/ui/text/render-text-geometry.ts';
    const embeddedUrl = '/src/core/text/embedded-font.ts';
    const { createTextWorkerSession: create } = (await import(sessionUrl)) as {
      createTextWorkerSession: typeof createTextWorkerSession;
    };
    const { renderTextGeometry: render } = (await import(renderUrl)) as {
      renderTextGeometry: typeof renderTextGeometry;
    };
    const { encodeEmbeddedFont: encode } = (await import(embeddedUrl)) as {
      encodeEmbeddedFont: typeof encodeEmbeddedFont;
    };
    const arabicResponse = await fetch('/src/core/text/__fixtures__/NotoSansArabic-Regular.ttf');
    if (!arabicResponse.ok) throw new Error('Arabic fixture unavailable');
    const arabic = encode({
      key: 'text-worker-arabic',
      fileName: 'NotoSansArabic-Regular.ttf',
      buffer: await arabicResponse.arrayBuffer(),
    });
    const paragraph = Array(12)
      .fill('Together we celebrate the love of Emma and James.')
      .join('\n');
    const base = {
      embeddedFonts: [arabic],
      sizeMm: 10,
      alignment: 'center',
      lineHeight: 1.3,
      letterSpacing: 0.02,
      color: '#123456',
    } as const;
    // Arabic goes first, so the worker starts HarfBuzz itself.
    const inputs = [
      { ...base, fontKey: arabic.key, content: 'مرحبا بالعالم KerfDesk 123' },
      { ...base, fontKey: 'roboto-regular', content: paragraph },
      { ...base, fontKey: 'great-vibes-regular', content: paragraph },
      { ...base, fontKey: 'ems-decorous-script', content: paragraph },
    ];
    const session = create();
    const outcomes = [];
    for (const input of inputs) {
      let settled = false;
      const pending = session.render(input).then((value) => {
        settled = true;
        return value;
      });
      const pendingAtNextTask = await new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(!settled), 0);
      });
      const viaWorker = await pending;
      const inThread = await render(input);
      outcomes.push({
        fontKey: input.fontKey,
        pendingAtNextTask,
        identical: JSON.stringify(viaWorker) === JSON.stringify(inThread),
      });
    }
    const stale = session.render({ ...base, fontKey: 'tinos-regular', content: paragraph }).then(
      () => 'completed',
      (error: unknown) => (error instanceof DOMException ? error.name : String(error)),
    );
    const fresh = await session.render({ ...base, fontKey: 'roboto-regular', content: paragraph });
    session.release();
    const freshPoints = fresh.paths[0]?.polylines.length ?? 0;
    return { outcomes, stale: await stale, freshHasInk: freshPoints > 0 };
  });
  expect(result).toEqual({
    outcomes: [
      { fontKey: 'text-worker-arabic', pendingAtNextTask: true, identical: true },
      { fontKey: 'roboto-regular', pendingAtNextTask: true, identical: true },
      { fontKey: 'great-vibes-regular', pendingAtNextTask: true, identical: true },
      { fontKey: 'ems-decorous-script', pendingAtNextTask: true, identical: true },
    ],
    stale: 'AbortError',
    freshHasInk: true,
  });
});
