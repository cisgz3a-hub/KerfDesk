import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { useCanvasTextStore, type CanvasTextSession } from './canvas-text-store';
import type { DialogValues } from './use-text-dialog-fields';

const mocks = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('./build-text-object', () => ({ buildTextObject: mocks.build }));
import { useCanvasTextDraft } from './use-canvas-text-draft';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const defaults: Omit<DialogValues, 'content'> = {
  fontKey: 'great-vibes-regular',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.4,
  letterSpacing: 0,
  bendDeg: 0,
  color: '#000000',
  embeddedFonts: [],
  weldOverlaps: true,
};

type Request = {
  readonly signal: AbortSignal;
  readonly resolve: (object: TextObject) => void;
};
let host: HTMLDivElement;
let root: Root;
let session: CanvasTextSession;
let requests: Request[];

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useCanvasTextStore.getState().beginAdd({ x: 30, y: 40 });
  const current = useCanvasTextStore.getState().session;
  if (current === null) throw new Error('Text session missing');
  session = current;
  requests = [];
  mocks.build.mockReset();
  mocks.build.mockImplementation(
    (_state, _values, signal: AbortSignal) =>
      new Promise<TextObject>((resolve) => requests.push({ signal, resolve })),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useCanvasTextStore.getState().close();
  resetStore();
  vi.useRealTimers();
});

function Harness({ content }: { readonly content: string }): JSX.Element {
  const draft = useCanvasTextDraft(session, { ...defaults, content });
  return <div>{draft.error ?? (draft.pending ? 'pending' : draft.object?.content)}</div>;
}

async function render(content: string): Promise<void> {
  await act(async () => root.render(<Harness content={content} />));
  await act(async () => vi.advanceTimersByTimeAsync(65));
}

function object(content: string): TextObject {
  return {
    ...defaults,
    kind: 'text',
    id: session.id,
    content,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}

describe('cancellable canvas text drafts', () => {
  it('aborts superseded work and retains only the latest result even when old work replies late', async () => {
    await render('old');
    const first = requests[0]!;
    expect(first.signal.aborted).toBe(false);
    await render('new');
    const second = requests[1]!;
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    await act(async () => second.resolve(object('new')));
    expect(useCanvasTextStore.getState().draft?.content).toBe('new');
    await act(async () => first.resolve(object('old')));
    expect(useCanvasTextStore.getState().draft?.content).toBe('new');
    expect(host.textContent).toBe('new');
  });

  it('aborts pending work when input is cleared or the editor unmounts', async () => {
    await render('pending');
    const first = requests[0]!;
    await render('');
    expect(first.signal.aborted).toBe(true);
    expect(requests).toHaveLength(1);
    expect(useCanvasTextStore.getState().draft).toBeNull();
    await render('another');
    const second = requests[1]!;
    await act(async () => root.render(null));
    expect(second.signal.aborted).toBe(true);
    await act(async () => second.resolve(object('another')));
    expect(useCanvasTextStore.getState().draft).toBeNull();
  });
});
