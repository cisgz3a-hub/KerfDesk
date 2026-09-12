import { expect, test } from './fixtures/kerfdesk-test';
import type { TextRenderResult } from '../src/core/text/text-to-polylines';

test('keeps foreground tasks responsive and cancels an unfinished real text weld worker', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const renderUrl = '/src/core/text/text-to-polylines.ts';
    const weldUrl = '/src/core/text/text-weld.ts';
    const clientUrl = '/src/ui/text/text-weld-worker-client.ts';
    const { textToPolylines } = (await import(
      renderUrl
    )) as typeof import('../src/core/text/text-to-polylines');
    const { weldTextRender } = (await import(
      weldUrl
    )) as typeof import('../src/core/text/text-weld');
    const { applyTextWeldInWorker } = (await import(clientUrl)) as {
      applyTextWeldInWorker: (
        rendered: TextRenderResult,
        fontKey: string,
        enabled: boolean,
        signal?: AbortSignal,
      ) => Promise<TextRenderResult>;
    };
    const fontBuffer = await (
      await fetch('/src/ui/text/fonts/GreatVibes-Regular.ttf')
    ).arrayBuffer();
    const rendered = await textToPolylines({
      fontBuffer,
      content: Array(30).fill('Together we celebrate the love of Emma and James.').join('\n'),
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.4,
      color: '#123456',
    });
    let completed = false;
    const pending = applyTextWeldInWorker(rendered, 'great-vibes-regular', true).then((value) => {
      completed = true;
      return value;
    });
    const pendingAtNextTask = await new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(!completed), 0);
    });
    const actual = await pending;
    const expected = weldTextRender(rendered);
    const sameGeometry =
      expected.kind === 'ok' && JSON.stringify(actual) === JSON.stringify(expected.value);

    const controller = new AbortController();
    let abortRan = false;
    const cancelled = applyTextWeldInWorker(
      rendered,
      'great-vibes-regular',
      true,
      controller.signal,
    ).then(
      () => 'completed',
      (error: unknown) => (error instanceof DOMException ? error.name : 'unexpected error'),
    );
    window.setTimeout(() => {
      abortRan = true;
      controller.abort();
    }, 50);
    return { pendingAtNextTask, sameGeometry, cancelled: await cancelled, abortRan };
  });
  expect(result).toEqual({
    pendingAtNextTask: true,
    sameGeometry: true,
    cancelled: 'AbortError',
    abortRan: true,
  });
});
