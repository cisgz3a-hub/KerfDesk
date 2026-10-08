import { describe, expect, it, vi } from 'vitest';
import { withAiRoutes } from './routes.js';
import { createAiRuntime } from './runtime.js';
import type { AiCredentialStore } from './credential-store.js';
import type { AiRequest } from './contracts.js';

const id = 'aaaa0000-0000-4000-8000-000000000001';
const request: AiRequest = {
  task: 'vector',
  prompt: 'A triangle',
  widthMm: 30,
  heightMm: 20,
  photo: null,
  candidates: [],
};
const draft = {
  title: 'Triangle',
  explanation: 'Review the outline.',
  paths: [
    {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 29, y: 1 },
        { x: 15, y: 19 },
      ],
    },
  ],
  matches: [],
};
function provider(value: unknown = draft, status = 'completed'): Response {
  return Response.json({
    status,
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  });
}
function setup(fetchProvider = vi.fn(async (_url: string, _init: RequestInit) => provider())) {
  const configuration = { apiKey: 'fake-key-for-tests-only', model: 'mock-model' };
  const store: AiCredentialStore = {
    available: async () => true,
    read: async () => configuration,
    write: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
  };
  const runtime = createAiRuntime(store, fetchProvider);
  const route = withAiRoutes(async () => new Response('fallback'), runtime);
  return { route, store, fetchProvider };
}
function appRequest(action: string, body?: unknown, extra?: RequestInit): Request {
  return new Request(`app://app/api/assistant/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-KerfDesk-Assistant': '1',
      'Content-Type': 'application/json',
      Origin: 'app://app',
      ...(action !== 'generate'
        ? {}
        : { 'X-KerfDesk-Assistant-Request': String((body as { requestId: string }).requestId) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...extra,
  });
}
describe('trusted desktop AI route and real provider boundary', () => {
  it('sends only allowlisted request and candidate fields', async () => {
    const input = {
      ...request,
      task: 'material',
      privateMetadata: 'synthetic-private-field',
      candidates: [
        { id: 'saved1', name: 'Wood', description: 'Measured.', path: 'synthetic-private-path' },
      ],
    };
    const { route, fetchProvider } = setup(vi.fn(async () => provider({ ...draft, paths: [] })));
    expect((await route(appRequest('generate', { requestId: id, request: input }))).status).toBe(
      200,
    );
    const sent = JSON.parse(String(fetchProvider.mock.calls[0]?.[1]?.body));
    const content = JSON.parse(sent.input[0].content[0].text);
    expect(content).toEqual({
      task: 'material',
      prompt: request.prompt,
      widthMm: 30,
      heightMm: 20,
      candidates: [{ id: 'saved1', name: 'Wood', description: 'Measured.' }],
    });
    expect(JSON.stringify(sent)).not.toContain('synthetic-private');
  });
  it('cancels while the owned request body is still being prepared', async () => {
    let bodyStarted = false;
    let bodyCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start: () => {
        bodyStarted = true;
      },
      cancel: () => {
        bodyCancelled = true;
      },
    });
    const { route, fetchProvider } = setup();
    const input = appRequest('generate', { requestId: id, request });
    Object.defineProperty(input, 'body', { value: body });
    const pending = route(input);
    await vi.waitFor(() => expect(bodyStarted).toBe(true));
    expect((await route(appRequest('cancel', { requestId: id }))).status).toBe(200);
    const response = await pending;
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('cancelled');
    expect(bodyCancelled).toBe(true);
    expect(fetchProvider).not.toHaveBeenCalled();
  });
  it('honours cancellation arriving before generation is dispatched', async () => {
    const { route, fetchProvider } = setup();
    await route(appRequest('cancel', { requestId: id }));
    const response = await route(appRequest('generate', { requestId: id, request }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('cancelled');
    expect(fetchProvider).not.toHaveBeenCalled();
  });
  it('rejects a missing or mismatched request header before any provider call', async () => {
    const { route, fetchProvider } = setup();
    const input = appRequest('generate', { requestId: id, request });
    input.headers.delete('X-KerfDesk-Assistant-Request');
    expect((await route(input)).status).toBe(400);
    const wrong = appRequest('generate', { requestId: id, request });
    wrong.headers.set('X-KerfDesk-Assistant-Request', 'bbbb0000-0000-4000-8000-000000000001');
    expect((await route(wrong)).status).toBe(400);
    expect(fetchProvider).not.toHaveBeenCalled();
  });
  it('strips unrecognized provider fields at the boundary', async () => {
    const { route } = setup(
      vi.fn(async () =>
        provider({
          ...draft,
          gcode: 'M3 S1000',
          paths: draft.paths.map((path) => ({ ...path, command: 'run' })),
        }),
      ),
    );
    const response = await route(appRequest('generate', { requestId: id, request }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
  });
  it('uses fixed Responses endpoint and strict JSON; returns no key or executable', async () => {
    const { route, fetchProvider } = setup();
    const status = await (await route(appRequest('status'))).json();
    expect(status).toEqual({ configured: true, secureStorage: true, model: 'mock-model' });
    expect(JSON.stringify(status)).not.toContain('fake-key');
    const response = await route(appRequest('generate', { requestId: id, request }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
    const [url, init] = fetchProvider.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.redirect).toBe('error');
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({
      model: 'mock-model',
      store: false,
      max_output_tokens: 8192,
      text: { format: { type: 'json_schema', strict: true } },
    });
    expect(sent).not.toHaveProperty('tools');
    expect(sent).not.toHaveProperty('previous_response_id');
    expect(sent.input[0].content).toEqual([
      { type: 'input_text', text: JSON.stringify({ ...request, photo: undefined }) },
    ]);
  });
  it.each([
    'app://app/api/assistant/status?key=x',
    'app://evil/api/assistant/status',
    'https://app/api/assistant/status',
    'app://user@app/api/assistant/status',
  ])('denies nonexact origin/address %s', async (url) => {
    const { route, fetchProvider } = setup();
    const input = appRequest('status');
    Object.defineProperty(input, 'url', { value: url });
    expect((await route(input)).status).toBe(404);
    expect(fetchProvider).not.toHaveBeenCalled();
  });
  it('denies missing headers and foreign origin; rejects oversized and malformed bodies', async () => {
    const { route, fetchProvider } = setup();
    expect((await route(new Request('app://app/api/assistant/status'))).status).toBe(404);
    expect(
      (
        await route(
          appRequest('status', undefined, {
            headers: { 'X-KerfDesk-Assistant': '1', Origin: 'https://evil.example' },
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await route(
          appRequest('generate', {
            requestId: id,
            request: { ...request, prompt: 'x'.repeat(4001) },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await route(
          appRequest(
            'generate',
            { requestId: id, request },
            {
              headers: {
                'X-KerfDesk-Assistant': '1',
                'Content-Type': 'application/json',
                'Content-Length': '2000001',
              },
            },
          ),
        )
      ).status,
    ).toBe(400);
    expect(fetchProvider).not.toHaveBeenCalled();
  });
  it.each([
    {
      ...draft,
      paths: [
        {
          closed: true,
          points: [
            { x: 31, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: 2 },
          ],
        },
      ],
    },
    { ...draft, paths: [] },
    { ...draft, title: '' },
    { ...draft, matches: [{ id: 'invented', reason: 'Use this.' }] },
  ])('rejects invalid output without a draft', async (value) => {
    const { route } = setup(vi.fn(async () => provider(value)));
    const response = await route(appRequest('generate', { requestId: id, request }));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });
  it('rejects incomplete/refused output and never reflects arbitrary network errors', async () => {
    const incomplete = setup(vi.fn(async () => provider(draft, 'incomplete')));
    expect(
      (await incomplete.route(appRequest('generate', { requestId: id, request }))).status,
    ).toBe(400);
    const refused = setup(
      vi.fn(async () =>
        Response.json({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
        }),
      ),
    );
    expect((await refused.route(appRequest('generate', { requestId: id, request }))).status).toBe(
      400,
    );
    const failure = setup(
      vi.fn(async () => {
        throw new Error('OpenAI secret-key-and-provider-body');
      }),
    );
    const text = await (
      await failure.route(appRequest('generate', { requestId: id, request }))
    ).text();
    expect(text).not.toContain('secret-key');
    expect(text).toContain('No changes');
  });
  it('sends a reviewed photo; restricts material matches to supplied IDs', async () => {
    const material: AiRequest = {
      ...request,
      task: 'material',
      photo: 'data:image/jpeg;base64,YQ==',
      candidates: [{ id: 'saved1', name: 'Wood', description: 'Measured test.' }],
    };
    const materialDraft = {
      ...draft,
      paths: [],
      matches: [{ id: 'saved1', reason: 'Similar visible grain; composition unknown.' }],
    };
    const { route, fetchProvider } = setup(vi.fn(async () => provider(materialDraft)));
    expect((await route(appRequest('generate', { requestId: id, request: material }))).status).toBe(
      200,
    );
    const sent = JSON.parse(String(fetchProvider.mock.calls[0]?.[1]?.body));
    expect(sent.input[0].content[1]).toEqual({
      type: 'input_image',
      image_url: material.photo,
      detail: 'auto',
    });
  });
  it('owns one request, cancels by ID, and ignores a delayed successful provider response', async () => {
    let finish: (response: Response) => void = () => undefined;
    const fetchProvider = vi.fn(
      (_url: string, _init: RequestInit) =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { route } = setup(fetchProvider);
    const pending = route(appRequest('generate', { requestId: id, request }));
    await vi.waitFor(() => expect(fetchProvider).toHaveBeenCalledOnce());
    expect(
      (
        await route(
          appRequest('generate', { requestId: 'bbbb0000-0000-4000-8000-000000000001', request }),
        )
      ).status,
    ).toBe(400);
    await route(appRequest('cancel', { requestId: id }));
    expect(fetchProvider.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    finish(provider());
    const response = await pending;
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('cancelled');
  });
});
