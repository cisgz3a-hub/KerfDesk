// @vitest-environment node
import { expect, it } from 'vitest';
import { withLicensingRoutes } from './licensing-routes';
import { createStartupSignals } from './licensing-startup-signals';
import { harness, saved } from './licensing-runtime.test-support';

it('waits for the current renderer acknowledgement rather than a sent Pro status', async () => {
  const signals = createStartupSignals(false);
  const seen: boolean[] = [];
  signals.admission.onChange((value) => seen.push(value));
  const route = withLicensingRoutes(
    async () => new Response('missing', { status: 404 }),
    harness(saved()).runtime,
    undefined,
    undefined,
    undefined,
    { observeRequest: signals.observeRequest, admitWorkspace: signals.admitWorkspace },
  );
  const status = await route(
    new Request('app://app/api/licensing/status', {
      headers: { 'X-KerfDesk-Licensing': '1' },
    }),
  );
  const sent = (await status.json()) as { edition: string; admissionGeneration: number };
  expect(sent.edition).toBe('pro');
  expect(seen).toEqual([false]);
  const acknowledge = (generation: number) =>
    route(
      new Request('app://app/api/licensing/workspace-admitted', {
        method: 'POST',
        headers: { 'X-KerfDesk-Licensing': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ generation }),
      }),
    );
  signals.admission.rendererOpening();
  await acknowledge(sent.admissionGeneration);
  expect(seen).toEqual([false]);
  const current = await route(
    new Request('app://app/api/licensing/status', {
      headers: { 'X-KerfDesk-Licensing': '1' },
    }),
  );
  await acknowledge(((await current.json()) as typeof sent).admissionGeneration);
  expect(seen).toEqual([false, true]);
  expect((await acknowledge(-1)).status).toBe(400);
});
