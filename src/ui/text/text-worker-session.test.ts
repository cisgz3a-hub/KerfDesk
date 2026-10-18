import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import { buildTextObject } from './build-text-object';
import type * as RenderTextGeometryModule from './render-text-geometry';
import { renderTextGeometry, type RenderTextGeometryInput } from './render-text-geometry';
import type { TextWorkerRequest, TextWorkerResponse } from './text-render-worker-protocol';
import { createTextWorkerRuntime } from './text-render-worker-runtime';
import { createTextWorkerSession, renderTextGeometryOffThread } from './text-worker-session';
import type { TextDialogState } from '../state/ui-store';
import type { DialogValues } from './use-text-dialog-fields';

const mocks = vi.hoisted(() => ({ fontLoads: 0 }));

vi.mock('./font-loader', () => ({
  loadFont: async (key: string) => {
    mocks.fontLoads += 1;
    const file = key === 'tinos-regular' ? 'Tinos-Regular.ttf' : 'Roboto-Regular.ttf';
    return fontFile(file);
  },
}));

// The font loader keeps one buffer per font for the session.
const fontFiles = new Map<string, Promise<ArrayBuffer>>();
function fontFile(name: string): Promise<ArrayBuffer> {
  let file = fontFiles.get(name);
  if (file === undefined) {
    file = readFile(`src/ui/text/fonts/${name}`).then(
      (data) =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    fontFiles.set(name, file);
  }
  return file;
}

vi.mock('./render-text-geometry', async (importOriginal) => {
  const original = await importOriginal<typeof RenderTextGeometryModule>();
  return { ...original, renderTextGeometry: vi.fn(original.renderTextGeometry) };
});

// Answers with the real worker runtime, but only when the test delivers it.
class FakeWorker {
  onmessage: ((event: MessageEvent<TextWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: TextWorkerRequest[] = [];
  terminated = false;
  private readonly runtime = createTextWorkerRuntime();

  constructor(
    private readonly auto: boolean,
    private readonly unpostable = false,
  ) {}

  postMessage(request: TextWorkerRequest): void {
    if (this.unpostable) throw new DOMException('cannot clone', 'DataCloneError');
    this.requests.push(structuredClone(request));
    if (this.auto) void this.reply();
  }

  async reply(index = this.requests.length - 1): Promise<void> {
    const request = this.requests[index];
    if (request === undefined) throw new Error('no request to answer');
    const { response, transfer } = await this.runtime.respond(request);
    this.send(structuredClone(response, { transfer }));
  }

  send(response: TextWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<TextWorkerResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function harness(
  options: {
    readonly auto?: boolean;
    readonly explicit?: boolean;
    readonly unpostable?: boolean;
  } = {},
) {
  const workers: FakeWorker[] = [];
  const session = createTextWorkerSession({
    ...(options.explicit === true ? { inThreadIfUnavailable: true } : {}),
    spawn: () => {
      const worker = new FakeWorker(options.auto ?? false, options.unpostable ?? false);
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
  return { session, workers };
}

const input = (patch: Partial<RenderTextGeometryInput> = {}): RenderTextGeometryInput => ({
  fontKey: 'roboto-regular',
  embeddedFonts: undefined,
  content: 'Hello world',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#000000',
  ...patch,
});

// Lets the session finish loading the font and post its request.
const posted = async (worker: () => FakeWorker | undefined, count: number) => {
  await vi.waitFor(() => expect(worker()?.requests.length ?? 0).toBeGreaterThanOrEqual(count));
};

beforeEach(() => {
  mocks.fontLoads = 0;
  vi.mocked(renderTextGeometry).mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe('text worker session (ADR-616)', () => {
  it('posts the font file once and then only the settings', async () => {
    const { session, workers } = harness({ auto: true });
    const first = await session.render(input());
    const second = await session.render(input({ content: 'Hello again', sizeMm: 12 }));
    expect(workers).toHaveLength(1);
    expect(workers[0]!.requests[0]!.font).toBeDefined();
    expect(workers[0]!.requests[1]!.font).toBeUndefined();
    expect(first).toStrictEqual(await renderTextGeometry(input()));
    expect(second).toStrictEqual(
      await renderTextGeometry(input({ content: 'Hello again', sizeMm: 12 })),
    );
  });

  it('posts a different font file when the font changes, and only the layout settings', async () => {
    const { session, workers } = harness({ auto: true });
    await session.render(input());
    const values = { ...input({ fontKey: 'tinos-regular' }), pathGuide: 'not posted' };
    await session.render(values);
    const request = workers[0]!.requests[1]!;
    expect(request.font).toBeDefined();
    expect(request.task).toStrictEqual({
      kind: 'render',
      input: {
        fontKey: 'tinos-regular',
        content: 'Hello world',
        sizeMm: 10,
        alignment: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        color: '#000000',
      },
      fontToken: request.font!.token,
    });
  });

  it('terminates busy work when a newer request supersedes it', async () => {
    const { session, workers } = harness();
    const stale = session.render(input({ content: 'stale' }));
    await posted(() => workers[0], 1);
    const fresh = session.render(input({ content: 'fresh' }));
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[0]!.onmessage).toBeNull();
    await posted(() => workers[1], 1);
    expect(workers[1]!.requests[0]!.font).toBeDefined();
    await workers[1]!.reply();
    await expect(fresh).resolves.toStrictEqual(
      await renderTextGeometry(input({ content: 'fresh' })),
    );
  });

  it('drops a request superseded while its font was loading, without posting it', async () => {
    const { session, workers } = harness({ auto: true });
    const stale = session.render(input({ content: 'stale' }));
    const fresh = session.render(input({ content: 'fresh' }));
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    await fresh;
    expect(workers.flatMap((worker) => worker.requests).map((request) => request.task)).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ content: 'fresh' }) }),
    ]);
  });

  it('ignores a reply for an older request id', async () => {
    const { session, workers } = harness();
    const first = session.render(input());
    await posted(() => workers[0], 1);
    await workers[0]!.reply();
    await first;
    const pending = session.render(input({ content: 'second' }));
    await posted(() => workers[0], 2);
    await workers[0]!.reply(0);
    workers[0]!.send({ id: 99, kind: 'fatal', message: 'stale' });
    await workers[0]!.reply(1);
    await expect(pending).resolves.toStrictEqual(
      await renderTextGeometry(input({ content: 'second' })),
    );
  });

  it('an aborted caller stops waiting and the finished worker stays warm', async () => {
    const { session, workers } = harness();
    const controller = new AbortController();
    const running = session.render(input(), controller.signal);
    await posted(() => workers[0], 1);
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]!.terminated).toBe(false);
    await workers[0]!.reply();
    const next = session.render(input({ content: 'next' }));
    await posted(() => workers[0], 2);
    expect(workers[0]!.requests[1]!.font).toBeUndefined();
    await workers[0]!.reply();
    await expect(next).resolves.toStrictEqual(await renderTextGeometry(input({ content: 'next' })));
    expect(workers).toHaveLength(1);
  });

  it('a newer request retires a worker still busy with aborted work', async () => {
    const { session, workers } = harness();
    const controller = new AbortController();
    const aborted = session.render(input(), controller.signal);
    await posted(() => workers[0], 1);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    const next = session.render(input({ content: 'next' }));
    expect(workers[0]!.terminated).toBe(true);
    await posted(() => workers[1], 1);
    await workers[1]!.reply();
    await expect(next).resolves.toBeDefined();
  });

  it('release cancels running work and the next request starts a fresh worker', async () => {
    const { session, workers } = harness();
    const running = session.render(input());
    await posted(() => workers[0], 1);
    session.release();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]!.terminated).toBe(true);
    const next = session.render(input());
    await posted(() => workers[1], 1);
    expect(workers[1]!.requests[0]!.font).toBeDefined();
    await workers[1]!.reply();
    await expect(next).resolves.toBeDefined();
  });

  it.each([
    [
      'a failed layout',
      (worker: FakeWorker) => worker.send({ id: 1, kind: 'fatal', message: 'Bad font.' }),
      'Bad font.',
    ],
    [
      'a crashed worker',
      (worker: FakeWorker) => worker.onerror?.(),
      'The background text layout stopped unexpectedly.',
    ],
    [
      'an unreadable reply',
      (worker: FakeWorker) => worker.onmessageerror?.(),
      'The background text layout reply could not be read.',
    ],
    [
      'a reply for another task',
      (worker: FakeWorker) => worker.send({ id: 1, kind: 'missing', characters: [] }),
      'The background text layout reply could not be read.',
    ],
  ])(
    'reports %s, retires the worker and never reruns it in thread',
    async (_name, fail, message) => {
      const { session, workers } = harness({ explicit: true });
      const running = session.render(input());
      await posted(() => workers[0], 1);
      fail(workers[0]!);
      await expect(running).rejects.toThrow(message);
      expect(workers[0]!.terminated).toBe(true);
      expect(renderTextGeometry).not.toHaveBeenCalled();
    },
  );

  it('in a browser, reports an unpostable request as unavailable', async () => {
    vi.stubGlobal('Worker', vi.fn());
    const { session, workers } = harness({ unpostable: true });
    const running = session.render(input());
    await expect(running).rejects.toThrow('The text could not be laid out in the background.');
    expect(workers[0]!.terminated).toBe(true);
    expect(renderTextGeometry).not.toHaveBeenCalled();
  });

  it('in a browser without a worker, previews report it and an explicit action lays out in thread', async () => {
    vi.stubGlobal('Worker', vi.fn());
    const preview = createTextWorkerSession({ spawn: () => null });
    await expect(preview.render(input())).rejects.toThrow(
      'The text could not be laid out in the background.',
    );
    expect(mocks.fontLoads).toBe(0);
    expect(renderTextGeometry).not.toHaveBeenCalled();
    const explicit = createTextWorkerSession({ inThreadIfUnavailable: true, spawn: () => null });
    await expect(explicit.render(input())).resolves.toBeDefined();
    expect(renderTextGeometry).toHaveBeenCalledTimes(1);
  });

  it('lays out in process under Vitest, which has no Worker', async () => {
    const rendered = await renderTextGeometryOffThread(input());
    expect(renderTextGeometry).toHaveBeenCalledTimes(1);
    expect(rendered.paths[0]?.polylines.length).toBeGreaterThan(0);
  });

  it('checks missing characters in the worker', async () => {
    const { session, workers } = harness({ auto: true });
    await expect(
      session.missingCharacters({
        fontKey: 'roboto-regular',
        embeddedFonts: undefined,
        content: 'a☃b',
      }),
    ).resolves.toStrictEqual(['☃']);
    expect(workers[0]!.requests[0]!.task.kind).toBe('missing-characters');
  });

  it('builds bent text through the worker exactly as on the UI thread', async () => {
    const { session } = harness({ auto: true });
    const values: DialogValues = {
      content: 'Bent around\nthe workshop door',
      fontKey: 'roboto-regular',
      sizeMm: 9,
      alignment: 'center',
      lineHeight: 1.3,
      letterSpacing: 0.05,
      bendDeg: 140,
      color: '#203040',
      embeddedFonts: [],
      weldOverlaps: true,
    };
    const state: TextDialogState = {
      mode: 'edit',
      id: 'text-1',
      content: values.content,
      fontKey: values.fontKey,
      sizeMm: values.sizeMm,
      alignment: values.alignment,
      lineHeight: values.lineHeight,
      letterSpacing: values.letterSpacing,
      color: values.color,
    };
    const viaWorker = await buildTextObject(state, values, undefined, session.render);
    const expected: TextObject = await buildTextObject(
      state,
      values,
      undefined,
      renderTextGeometry,
    );
    expect(viaWorker).toStrictEqual(expected);
    expect(JSON.stringify(viaWorker)).toBe(JSON.stringify(expected));
    expect(viaWorker.transform).toStrictEqual(IDENTITY_TRANSFORM);
  });
});
