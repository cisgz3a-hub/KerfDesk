import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  RENDERER_LICENSING_SOURCE,
  RENDERER_NODE_PRIMITIVES_SOURCE,
} from './native-smoke-renderer.js';

describe('packaged renderer Node exposure evidence', () => {
  it('observes absent primitives in a browser-like realm', () => {
    expect(runInNewContext(RENDERER_NODE_PRIMITIVES_SOURCE)).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      Buffer: 'undefined',
    });
  });

  it('reports leaked Node primitives without invoking any of them', () => {
    const forbidden = () => {
      throw new Error('the smoke must only inspect primitive types');
    };
    expect(
      runInNewContext(RENDERER_NODE_PRIMITIVES_SOURCE, {
        require: forbidden,
        process: { exit: forbidden },
        module: { require: forbidden },
        Buffer: forbidden,
      }),
    ).toEqual({ require: 'function', process: 'object', module: 'object', Buffer: 'function' });
  });
});

describe('packaged renderer licensing observation', () => {
  it('skips browser origins without trying any licensing endpoint', async () => {
    const fetch = vi.fn();
    const result = await runInNewContext(RENDERER_LICENSING_SOURCE, {
      location: { protocol: 'https:', host: 'kerfdesk.com' },
      fetch,
    });
    expect(result).toEqual({ kind: 'not-app-runtime' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads only two guarded local GETs and records no private fields', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          channel: 'commercial',
          state: 'activation-required',
          edition: 'free',
          licenseKey: 'private-key',
          paymentOrderId: 'private-order',
          message: 'private-message',
        }),
      )
      .mockResolvedValueOnce(Response.json({ state: 'unavailable', currentVersion: '0.0.1' }));
    const result = await runInNewContext(RENDERER_LICENSING_SOURCE, {
      location: { protocol: 'app:', host: 'app' },
      fetch,
    });
    expect(result).toEqual({
      kind: 'observed',
      channel: 'commercial',
      state: 'activation-required',
      edition: 'free',
      proEnabled: false,
      updateState: 'unavailable',
    });
    expect(fetch.mock.calls).toEqual(
      ['status', 'update-status'].map((action) => [
        `app://app/api/licensing/${action}`,
        {
          method: 'GET',
          headers: { 'X-KerfDesk-Licensing': '1' },
          cache: 'no-store',
          redirect: 'error',
        },
      ]),
    );
  });

  it('fails on an unavailable local route without copying its response body', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ secret: 'do-not-copy' }, { status: 503 }));
    await expect(
      runInNewContext(RENDERER_LICENSING_SOURCE, {
        location: { protocol: 'app:', host: 'app' },
        fetch,
      }),
    ).rejects.toThrow('Local licensing status returned HTTP 503');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
