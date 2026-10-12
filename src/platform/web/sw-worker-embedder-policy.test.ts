import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://kerfdesk.test';
const guardSource = readFileSync(
  resolve(process.cwd(), 'public/sw-worker-embedder-policy.js'),
  'utf8',
);

type FakeRequest = { readonly method: string; readonly destination: string; readonly url: string };

// The generated service worker imports the guard first, then Workbox calls
// respondWith on the same FetchEvent prototype.
function loadGuard(): (request: FakeRequest, response: Response) => Promise<Response> {
  class FakeFetchEvent {
    answer: Promise<Response> | undefined;
    constructor(readonly request: FakeRequest) {}
    respondWith(response: Response | Promise<Response>): void {
      this.answer = Promise.resolve(response);
    }
  }
  runInNewContext(guardSource, {
    self: { location: { origin: ORIGIN } },
    FetchEvent: FakeFetchEvent,
    Response,
    Headers,
    URL,
    Set,
    Promise,
  });
  return async (request, response) => {
    const event = new FakeFetchEvent(request);
    event.respondWith(response);
    if (event.answer === undefined) throw new Error('No response');
    return event.answer;
  };
}

const workerScript = (path: string): FakeRequest => ({
  method: 'GET',
  destination: 'worker',
  url: `${ORIGIN}${path}`,
});

describe('service worker embedder-policy guard', () => {
  it('adds COEP to a cached worker script stored before the header existed', async () => {
    const serve = loadGuard();
    const cached = new Response('self.onmessage = () => {};', {
      status: 200,
      headers: { 'Content-Type': 'application/javascript' },
    });

    const served = await serve(workerScript('/assets/trace-worker-BKs3AtWO.js'), cached);

    expect(served.headers.get('Cross-Origin-Embedder-Policy')).toBe('credentialless');
    expect(served.headers.get('Content-Type')).toBe('application/javascript');
    expect(served.status).toBe(200);
    await expect(served.text()).resolves.toBe('self.onmessage = () => {};');
  });

  it('keeps a policy the server already sent', async () => {
    const serve = loadGuard();
    const fresh = new Response('', { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' } });

    const served = await serve(workerScript('/assets/a-worker.js'), fresh);

    expect(served).toBe(fresh);
  });

  it.each([
    {
      name: 'a page script',
      request: { ...workerScript('/assets/app.js'), destination: 'script' },
    },
    {
      name: 'a cross-origin worker',
      request: { ...workerScript(''), url: 'https://cdn.test/w.js' },
    },
    { name: 'a non-GET request', request: { ...workerScript('/assets/w.js'), method: 'POST' } },
  ])('leaves $name untouched', async ({ request }) => {
    const serve = loadGuard();
    const response = new Response('');

    expect(await serve(request, response)).toBe(response);
  });

  it('is imported by the generated service worker', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

    expect(viteConfig).toContain("importScripts: ['sw-worker-embedder-policy.js']");
  });
});
