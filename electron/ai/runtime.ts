import { AiFailure } from './failure.js';
import type { AiCredentialStore } from './credential-store.js';
import type { AiConfiguration, AiRequest } from './contracts.js';
import { requestAiDraft } from './provider.js';

export function createAiRuntime(
  store: AiCredentialStore,
  fetchProvider: (url: string, init: RequestInit) => Promise<Response>,
) {
  let active: { id: string; controller: AbortController } | null = null;
  let writes: Promise<void> = Promise.resolve();
  const earlyCancellations = new Map<string, number>();
  const cancel = (id?: string): void => {
    if (active !== null && (id === undefined || active.id === id)) active.controller.abort();
    else if (id !== undefined) {
      earlyCancellations.set(id, Date.now() + 120_000);
      if (earlyCancellations.size > 128) {
        const oldest = earlyCancellations.keys().next().value;
        if (oldest !== undefined) earlyCancellations.delete(oldest);
      }
    }
  };
  const status = async () => {
    await writes;
    const secureStorage = await store.available();
    const configuration = secureStorage ? await store.read() : null;
    return { configured: configuration !== null, secureStorage, model: configuration?.model ?? '' };
  };
  const update = (run: () => Promise<void>) => {
    cancel();
    const next = writes.then(run, run);
    writes = next.catch(() => undefined);
    return next.then(status);
  };
  return {
    status,
    configure: (configuration: AiConfiguration) => update(() => store.write(configuration)),
    forget: () => update(() => store.forget()),
    cancel,
    async generate(
      id: string,
      request: AiRequest | ((signal: AbortSignal) => Promise<AiRequest>),
      signal: AbortSignal,
    ): Promise<unknown> {
      if (wasCancelled(earlyCancellations, id))
        throw new AiFailure('Assistant request cancelled or timed out.');
      if (active !== null) throw new AiFailure('An assistant request is already running.');
      const controller = new AbortController();
      const operation = { id, controller };
      active = operation;
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) controller.abort();
      const timeout = setTimeout(abort, 120_000);
      try {
        const parsed = typeof request === 'function' ? await request(controller.signal) : request;
        await writes;
        const configuration = await store.read();
        if (configuration === null)
          throw new AiFailure('Configure your OpenAI API key and model first.');
        if (controller.signal.aborted)
          throw new AiFailure('Assistant request cancelled or timed out.');
        const draft = await requestAiDraft(configuration, parsed, controller.signal, fetchProvider);
        if (controller.signal.aborted)
          throw new AiFailure('Assistant request cancelled or timed out.');
        return draft;
      } catch (error) {
        if (controller.signal.aborted)
          throw new AiFailure('Assistant request cancelled or timed out.');
        throw error;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        if (active === operation) active = null;
      }
    },
  };
}
export type AiRuntime = ReturnType<typeof createAiRuntime>;
function wasCancelled(cancellations: Map<string, number>, id: string): boolean {
  const now = Date.now();
  for (const [cancelledId, expiry] of cancellations)
    if (expiry < now) cancellations.delete(cancelledId);
  return cancellations.has(id);
}
