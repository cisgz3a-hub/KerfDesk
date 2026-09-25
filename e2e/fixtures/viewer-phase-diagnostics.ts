import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { open, writeFile } from 'node:fs/promises';

const CAPTURE_TIMEOUT_MS = 5_000;

type DiagnosticWindow = typeof window & {
  __KERFDESK_VIEWER_DIAGNOSTICS__?: {
    observer: PerformanceObserver;
    tasks: { startTime: number; duration: number }[];
  };
};

/** Records only this viewer phase; diagnostic failures never replace its assertions. */
export async function withViewerPhaseDiagnostics(
  page: Page,
  testInfo: TestInfo,
  run: (endPhase: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const report = (error: unknown): void => {
    testInfo.annotations.push({ type: 'diagnostic-error', description: String(error) });
  };
  let capture: Awaited<ReturnType<typeof beginCapture>> | undefined;
  try {
    capture = await beginCapture(page);
  } catch (error) {
    report(error);
  }
  let failed = false;
  const endPhase = async (): Promise<void> => {
    try {
      await capture?.stop();
    } catch (error) {
      report(error);
    }
  };
  try {
    await run(endPhase);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await endPhase();
    try {
      await capture?.finish(failed, testInfo);
    } catch (error) {
      report(error);
    }
  }
}

async function beginCapture(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const complete = new Promise<string | undefined>((resolve) => {
    cdp.once('Tracing.tracingComplete', (event) => resolve(event.stream));
  });
  try {
    await bounded(
      cdp.send('Tracing.start', {
        categories: 'devtools.timeline,v8,blink.user_timing,gpu,cc,viz,benchmark',
        transferMode: 'ReturnAsStream',
      }),
    );
    await page.evaluate(() => {
      const tasks: { startTime: number; duration: number }[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          tasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      (window as DiagnosticWindow).__KERFDESK_VIEWER_DIAGNOSTICS__ = { observer, tasks };
      performance.mark('kerfdesk-viewer-probe-start');
    });
  } catch (error) {
    await bounded(cdp.send('Tracing.end')).catch(() => undefined);
    await cdp.detach().catch(() => undefined);
    throw error;
  }
  let stopped: Promise<void> | undefined;
  let stream: string | undefined;
  let metadata: unknown;
  const stop = (): Promise<void> =>
    (stopped ??= bounded(
      (async () => {
        metadata = await page
          .evaluate(() => {
            performance.mark('kerfdesk-viewer-probe-end');
            const capture = (window as DiagnosticWindow).__KERFDESK_VIEWER_DIAGNOSTICS__;
            if (capture !== undefined) {
              for (const entry of capture.observer.takeRecords()) {
                capture.tasks.push({ startTime: entry.startTime, duration: entry.duration });
              }
              capture.observer.disconnect();
              delete (window as DiagnosticWindow).__KERFDESK_VIEWER_DIAGNOSTICS__;
            }
            // Ready proves this canvas already owns the renderer's WebGL2 context.
            // Read it after the measured phase; never create a diagnostic canvas.
            const canvas = document.querySelector<HTMLCanvasElement>(
              '[data-viewer-state="ready"] .gcode-viewer-canvas',
            );
            const gl = canvas?.getContext('webgl2');
            const rendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
            const webgl =
              gl == null
                ? null
                : {
                    vendor: gl.getParameter(gl.VENDOR) as unknown,
                    renderer: gl.getParameter(gl.RENDERER) as unknown,
                    unmaskedVendor:
                      rendererInfo == null
                        ? null
                        : (gl.getParameter(rendererInfo.UNMASKED_VENDOR_WEBGL) as unknown),
                    unmaskedRenderer:
                      rendererInfo == null
                        ? null
                        : (gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) as unknown),
                  };
            return {
              timeOrigin: performance.timeOrigin,
              marks: performance
                .getEntriesByType('mark')
                .filter((entry) => entry.name.startsWith('kerfdesk-viewer-probe-'))
                .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
              longTasks: capture?.tasks ?? [],
              hardwareConcurrency: navigator.hardwareConcurrency,
              userAgent: navigator.userAgent,
              webgl,
            };
          })
          .catch((error: unknown) => ({ captureError: String(error) }));
        await cdp.send('Tracing.end');
        stream = await complete;
      })(),
    ));
  return {
    stop,
    async finish(failed: boolean, testInfo: TestInfo): Promise<void> {
      try {
        if (failed) {
          await writeFile(
            testInfo.outputPath('viewer-diagnostics.json'),
            JSON.stringify(
              {
                browserVersion: page.context().browser()?.version(),
                githubSha: process.env['GITHUB_SHA'],
                phase: metadata,
              },
              null,
              2,
            ),
          );
          if (stream !== undefined) {
            const path = testInfo.outputPath('viewer-timeline.json');
            await bounded(saveStream(cdp, stream, path));
            await testInfo.attach('viewer-timeline', { path, contentType: 'application/json' });
          }
        }
      } finally {
        if (stream !== undefined)
          await cdp.send('IO.close', { handle: stream }).catch(() => undefined);
        await cdp.detach().catch(() => undefined);
      }
    },
  };
}

async function saveStream(cdp: CDPSession, stream: string, path: string): Promise<void> {
  const file = await open(path, 'w');
  try {
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle: stream, size: 1024 * 1024 });
      await file.write(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
      if (chunk.eof) return;
    }
  } finally {
    await file.close();
  }
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Viewer diagnostic capture timed out')),
          CAPTURE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
