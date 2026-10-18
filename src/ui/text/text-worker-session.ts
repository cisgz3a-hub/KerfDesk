// Canvas text editing lays text out through the text worker (ADR-624).
//
// A session belongs to one owner (the canvas draft, the text-frame preview,
// the variable-row preview, the missing-glyph check) and keeps one worker for
// it. A newer request supersedes the owner's older one, which rejects with an
// AbortError. One explicit action (Save, Add Text) uses its own session for
// one request.
//
// Only SSR and Vitest, which have no Worker, lay text out in process. In a
// real browser a session whose worker cannot start reports it, except for an
// explicit action, which then lays the text out on this thread as it did
// before. Work that started in the worker and failed is reported, never rerun
// here.

import type { EmbeddedFont } from '../../core/scene';
import {
  outlineFontMissingCharacters,
  type TextRenderResult,
} from '../../core/text/text-to-polylines';
import { loadFont } from './font-loader';
import { renderTextGeometry, type RenderTextGeometryInput } from './render-text-geometry';
import { textGeometryRequest, usesOutlineFontFile } from './text-geometry-compute';
import {
  spawnTextRenderWorker,
  TEXT_WORKER_UNAVAILABLE,
  TextWorkerClient,
  textWorkerFont,
  type TextWorkerOutcome,
  type TextWorkerSpawner,
} from './text-worker-client';

export type TextGeometryRenderer = (
  input: RenderTextGeometryInput,
  signal?: AbortSignal,
) => Promise<TextRenderResult>;

export type MissingCharactersQuery = {
  readonly fontKey: string;
  readonly embeddedFonts: ReadonlyArray<EmbeddedFont> | undefined;
  readonly content: string;
};

export type TextWorkerSession = {
  readonly render: TextGeometryRenderer;
  /** The characters of `content` an outline font has no glyph for. */
  readonly missingCharacters: (
    query: MissingCharactersQuery,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<string>>;
  /** Cancels running work and releases the worker. The session stays usable. */
  readonly release: () => void;
};

export type TextWorkerSessionOptions = {
  /** An explicit action may lay text out on this thread when no worker can start. */
  readonly inThreadIfUnavailable?: boolean;
  readonly spawn?: TextWorkerSpawner;
};

export function createTextWorkerSession(options: TextWorkerSessionOptions = {}): TextWorkerSession {
  const client = new TextWorkerClient(options.spawn ?? spawnTextRenderWorker);
  const finish = async <R>(outcome: TextWorkerOutcome<R>, inThread: () => Promise<R>) => {
    switch (outcome.kind) {
      case 'done':
        return outcome.result;
      case 'superseded':
        throw cancelled();
      case 'unavailable':
        if (inProcessAllowed() || options.inThreadIfUnavailable === true) return inThread();
        throw new Error(outcome.message);
      case 'failed':
        throw new Error(outcome.message);
    }
  };
  return {
    async render(input, signal) {
      const ticket = client.claim();
      const inThread = () => renderTextGeometry(input);
      if (ticket === null) return finish(TEXT_WORKER_UNAVAILABLE, inThread);
      const font = usesOutlineFontFile(input.fontKey)
        ? textWorkerFont(await loadFont(input.fontKey, input.embeddedFonts))
        : undefined;
      const task = {
        kind: 'render' as const,
        input: textGeometryRequest(input),
        ...(font === undefined ? {} : { fontToken: font.token }),
      };
      return finish(await client.run(ticket, task, font, signal), inThread);
    },
    async missingCharacters(query, signal) {
      const ticket = client.claim();
      const inThread = async () =>
        outlineFontMissingCharacters(
          await loadFont(query.fontKey, query.embeddedFonts),
          query.content,
        );
      if (ticket === null) return finish(TEXT_WORKER_UNAVAILABLE, inThread);
      const font = textWorkerFont(await loadFont(query.fontKey, query.embeddedFonts));
      const task = {
        kind: 'missing-characters' as const,
        content: query.content,
        fontToken: font.token,
      };
      return finish(await client.run(ticket, task, font, signal), inThread);
    },
    release: () => client.release(),
  };
}

/**
 * Lays text out for one explicit action in its own worker, released once it
 * settles. Only this path may fall back to the UI thread (ADR-609 point 7).
 */
export async function renderTextGeometryOffThread(
  input: RenderTextGeometryInput,
  signal?: AbortSignal,
): Promise<TextRenderResult> {
  const session = createTextWorkerSession({ inThreadIfUnavailable: true });
  try {
    return await session.render(input, signal);
  } finally {
    session.release();
  }
}

function cancelled(): DOMException {
  return new DOMException('Text editing cancelled.', 'AbortError');
}

// SSR and Vitest have no browser worker runtime. A real browser must never
// silently move text layout back onto its input thread.
function inProcessAllowed(): boolean {
  if (typeof Worker !== 'undefined') return false;
  const nodeTest =
    import.meta.env.MODE === 'test' &&
    typeof process !== 'undefined' &&
    process.versions?.node !== undefined;
  return import.meta.env.SSR || nodeTest;
}
