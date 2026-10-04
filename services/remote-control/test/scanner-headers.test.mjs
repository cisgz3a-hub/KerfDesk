import assert from 'node:assert/strict';
import test from 'node:test';
import { ORIGIN, start } from './support.mjs';

test('Only the successful top-level phone control document permits its own camera', async () => {
  const worker = start();
  try {
    for (const path of ['/', '/control']) {
      const response = await worker.dispatchFetch(ORIGIN + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Content-Type'), /^text\/html/);
      assert.equal(
        response.headers.get('Permissions-Policy'),
        'camera=(self), microphone=(), geolocation=()',
      );
      assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
      const csp = response.headers.get('Content-Security-Policy');
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /media-src blob:/);
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/);
    }
    for (const path of ['/health', '/api/session', '/authorize', '/mcp', '/unknown']) {
      const response = await worker.dispatchFetch(ORIGIN + path);
      assert.equal(
        response.headers.get('Permissions-Policy'),
        'camera=(), microphone=(), geolocation=()',
      );
      assert.doesNotMatch(response.headers.get('Content-Security-Policy'), /media-src/);
    }
  } finally {
    await worker.dispose();
  }
});

test('Scanner assets are served locally with scripts disallowed from requesting a camera', async () => {
  const worker = start();
  try {
    for (const path of [
      '/control-actions.js',
      '/control-scanner.js',
      '/control-scanner-link.js',
      '/control-scanner-reader.js',
      '/control-scanner-camera.js',
      '/control-scanner-decoder.js',
      '/control-scanner.css',
      '/control-touch.js',
      '/control-touch-view.js',
      '/control-touch-geometry.js',
      '/control-touch.css',
    ]) {
      const response = await worker.dispatchFetch(ORIGIN + path);
      assert.equal(response.status, 200, path);
      assert.equal(
        response.headers.get('Permissions-Policy'),
        'camera=(), microphone=(), geolocation=()',
      );
      assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.equal(response.headers.get('Cache-Control'), 'no-store, no-transform');
      assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    }
    const decoder = await (
      await worker.dispatchFetch(ORIGIN + '/control-scanner-decoder.js')
    ).text();
    assert.match(decoder, /@nuintun\/qrcode 5\.0\.3 \(MIT\)/);
    const notices = await (await worker.dispatchFetch(ORIGIN + '/third-party-notices.txt')).text();
    assert.match(notices, /@nuintun\/qrcode@5\.0\.3/);
    assert.match(notices, /Copyright \(c\) 2018 nuintun/);
  } finally {
    await worker.dispose();
  }
});
