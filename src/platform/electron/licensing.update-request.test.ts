import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDesktopLicenceAdapter } from './licensing';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const status = {
  state: 'downloading',
  mode: 'manual',
  currentVersion: '1.0.7',
  version: '1.0.8',
  checkedAt: null,
  installOnQuit: false,
};

it.each(['updateStatus', 'checkForUpdates', 'downloadUpdate'] as const)(
  'bounds an unanswered %s and aborts the bridge without repeating the command',
  async (action) => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn(
      (_url: string, _init: RequestInit) =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const client = createDesktopLicenceAdapter(fetcher);
    let outcome: string | undefined;
    const request = client[action]!().then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'timed-out';
      },
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(outcome).toBe('timed-out');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true);
    release(Response.json(status));
    await request;
    expect(outcome).toBe('timed-out');
  },
);

it('bounds a stuck JSON body as well as headers and allows a fresh status read afterwards', async () => {
  let release!: (value: unknown) => void;
  const fetcher = vi.fn(
    async () =>
      ({
        ok: true,
        json: () =>
          new Promise<unknown>((resolve) => {
            release = resolve;
          }),
      }) as Response,
  );
  const client = createDesktopLicenceAdapter(fetcher);
  let outcome: string | undefined;
  const request = client.updateStatus().then(
    () => {
      outcome = 'resolved';
    },
    () => {
      outcome = 'timed-out';
    },
  );
  await vi.advanceTimersByTimeAsync(15_000);
  expect(outcome).toBe('timed-out');
  fetcher.mockResolvedValueOnce(Response.json(status));
  expect(await client.updateStatus()).toMatchObject(status);
  release({ ...status, state: 'ready' });
  await request;
  expect(outcome).toBe('timed-out');
});
