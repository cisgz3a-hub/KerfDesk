// The last problems this window hit, for Help > Save Support Report (ADR-546).
// Neither a browser tab nor the packaged desktop app shows a console, so
// without these a report could only say that something went wrong. They stay
// in memory and end with the window; the desktop app's log keeps its own copy.

export type RendererProblemKind = 'error' | 'unhandled rejection' | 'crash';

export type RendererProblem = {
  readonly at: number;
  readonly kind: RendererProblemKind;
  readonly message: string;
};

type ProblemTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

const MAX_PROBLEMS = 50;
const MAX_MESSAGE_CHARS = 2000;

let problems: ReadonlyArray<RendererProblem> = [];

export function recordRendererProblem(
  kind: RendererProblemKind,
  reason: unknown,
  at: number = Date.now(),
): void {
  problems = [...problems, { at, kind, message: describeProblem(reason) }].slice(-MAX_PROBLEMS);
}

/** The newest problems, oldest first. */
export function recentRendererProblems(): ReadonlyArray<RendererProblem> {
  return problems;
}

export function clearRendererProblems(): void {
  problems = [];
}

/** Records uncaught errors and unhandled promise rejections until the returned stop runs. */
export function watchRendererProblems(target: ProblemTarget = window): () => void {
  const onError = (event: Event): void => {
    const error = event as ErrorEvent;
    recordRendererProblem('error', error.error ?? error.message);
  };
  const onRejection = (event: Event): void => {
    recordRendererProblem('unhandled rejection', (event as PromiseRejectionEvent).reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

function describeProblem(reason: unknown): string {
  const text = reason instanceof Error ? describeError(reason) : String(reason);
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

// Chromium's stack starts with "Name: message"; Firefox's and Safari's do not.
function describeError(error: Error): string {
  const head = `${error.name}: ${error.message}`;
  const stack = error.stack ?? '';
  if (stack.startsWith(head)) return stack;
  return stack === '' ? head : `${head}\n${stack}`;
}
