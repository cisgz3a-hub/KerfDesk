import { describe, expect, it, vi } from 'vitest';
import type { AiDraft, AiRequest } from '../../core/ai/assistant';
import { createDesktopAiAssistant } from './desktop-ai';
const request: AiRequest = {
  task: 'vector',
  prompt: 'Triangle',
  widthMm: 20,
  heightMm: 20,
  photo: null,
  candidates: [],
};
const draft: AiDraft = {
  title: 'Triangle',
  explanation: 'Review it',
  matches: [],
  paths: [
    {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 10, y: 1 },
        { x: 1, y: 10 },
      ],
    },
  ],
};
describe('desktop assistant route boundary', () => {
  it('uses guarded same-origin routes and keeps saved credentials out of status and generation requests', async () => {
    const fetchRoute = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        configured: true,
        secureStorage: true,
        model: 'fake-model',
        apiKey: 'fake-private-sentinel',
      }),
    );
    const assistant = createDesktopAiAssistant(fetchRoute);
    expect(fetchRoute).not.toHaveBeenCalled();
    expect(await assistant.status()).toEqual({
      configured: true,
      secureStorage: true,
      model: 'fake-model',
    });
    const initial = fetchRoute.mock.calls[0]!;
    expect(initial[0]).toBe('./api/assistant/status');
    expect(initial[1].body).toBeUndefined();
    await assistant.configure('fake-test-key', 'fake-model');
    fetchRoute.mockResolvedValueOnce(Response.json(draft));
    const response = await assistant.generate(request, new AbortController().signal);
    expect(response).toEqual(draft);
    const generation = fetchRoute.mock.calls[2]!;
    expect(generation[0]).toBe('./api/assistant/generate');
    expect(generation[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'X-KerfDesk-Assistant': '1' },
    });
    const payload = JSON.parse(String(generation[1].body)) as {
      request: AiRequest;
      requestId: string;
    };
    expect(payload.request).toEqual(request);
    expect(payload.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(generation[1].body).not.toContain('fake-test-key');
    expect(generation[1].body).not.toContain('fake-private-sentinel');
  });
  it('cancels by owned request ID and ignores a delayed route response', async () => {
    let finish: (value: Response) => void = () => undefined;
    const fetchRoute = vi.fn((url: string, _init: RequestInit) =>
      url.endsWith('/cancel')
        ? Promise.resolve(Response.json({ cancelled: true }))
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    );
    const controller = new AbortController();
    const pending = createDesktopAiAssistant(fetchRoute).generate(request, controller.signal);
    const outcome = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    const calls = fetchRoute.mock.calls;
    expect(calls).toHaveLength(2);
    const first = JSON.parse(String(calls[0]![1].body)) as { requestId: string };
    const cancel = JSON.parse(String(calls[1]![1].body)) as { requestId: string };
    expect(cancel).toEqual({ requestId: first.requestId });
    finish(Response.json(draft));
    await outcome;
    expect(fetchRoute).toHaveBeenCalledTimes(2);
  });
  it('does not send an already cancelled request and removes the abort handler on completion', async () => {
    const fetchRoute = vi.fn(async (_url: string, _init: RequestInit) => Response.json(draft));
    const cancelled = new AbortController();
    cancelled.abort();
    const assistant = createDesktopAiAssistant(fetchRoute);
    await expect(assistant.generate(request, cancelled.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchRoute).not.toHaveBeenCalled();
    const completed = new AbortController();
    await assistant.generate(request, completed.signal);
    completed.abort();
    expect(fetchRoute).toHaveBeenCalledOnce();
  });
  it.each([
    {
      ...draft,
      paths: [
        {
          closed: true,
          points: [
            { x: -1, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: 2 },
          ],
        },
      ],
    },
    { ...draft, matches: [{ id: 'unknown', reason: 'Not reviewed' }], paths: [] },
    { ...draft, paths: Array.from({ length: 101 }, () => draft.paths[0]) },
  ])('validates malformed or unreviewed results before returning to the UI', async (value) => {
    const assistant = createDesktopAiAssistant(async () => Response.json(value));
    await expect(assistant.generate(request, new AbortController().signal)).rejects.toThrow();
  });
  it('rejects invalid status and handles bounded route error messages without retrying', async () => {
    const fetchRoute = vi.fn(async () =>
      Response.json({ error: 'Request denied' }, { status: 400 }),
    );
    const assistant = createDesktopAiAssistant(fetchRoute);
    await expect(assistant.generate(request, new AbortController().signal)).rejects.toThrow(
      'Request denied',
    );
    expect(fetchRoute).toHaveBeenCalledOnce();
    const invalid = createDesktopAiAssistant(async () =>
      Response.json({ configured: true, model: 'x' }),
    );
    await expect(invalid.status()).rejects.toThrow('status is unavailable');
  });
});
