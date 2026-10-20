// @vitest-environment node
import { expect, it } from 'vitest';
import type { LicensingRuntime } from './licensing-runtime';
import { withLicensingRoutes } from './licensing-routes';
import { createStartupSignals } from './licensing-startup-signals';
import { harness, saved, trialClaims } from './licensing-runtime.test-support';

type Sent = {
  edition: string;
  state: string;
  admissionGeneration: number;
  sessionAdmitted?: boolean;
};

function admissionRoutes(runtime: LicensingRuntime, signals = createStartupSignals(false)) {
  const route = withLicensingRoutes(
    async () => new Response('missing', { status: 404 }),
    runtime,
    undefined,
    undefined,
    undefined,
    {
      observeRequest: signals.observeRequest,
      admitWorkspace: signals.admitWorkspace,
      sessionAdmitted: signals.sessionAdmitted,
    },
  );
  return {
    status: async (): Promise<Sent> => {
      const response = await route(
        new Request('app://app/api/licensing/status', {
          headers: { 'X-KerfDesk-Licensing': '1' },
        }),
      );
      return (await response.json()) as Sent;
    },
    acknowledge: (generation: number) =>
      route(
        new Request('app://app/api/licensing/workspace-admitted', {
          method: 'POST',
          headers: { 'X-KerfDesk-Licensing': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ generation }),
        }),
      ),
  };
}

it('waits for the current renderer acknowledgement rather than a sent Pro status', async () => {
  const signals = createStartupSignals(false);
  const seen: boolean[] = [];
  signals.admission.onChange((value) => seen.push(value));
  const { status, acknowledge } = admissionRoutes(harness(saved()).runtime, signals);
  const sent = await status();
  expect(sent.edition).toBe('pro');
  expect(sent.sessionAdmitted).toBeUndefined();
  expect(seen).toEqual([false]);
  signals.admission.rendererOpening();
  await acknowledge(sent.admissionGeneration);
  expect(seen).toEqual([false]);
  await acknowledge((await status()).admissionGeneration);
  expect(seen).toEqual([false, true]);
  expect((await acknowledge(-1)).status).toBe(400);
});

// ADR-623 Amendment 1: the window lets the device in once per app session, so a
// renderer reloaded after a crash reaches its workspace and job recovery even
// though the trial ended in the meantime. A fresh launch opens behind the window.
it('lets a renderer reloaded after the trial ended back into its admitted session', async () => {
  const expiry = trialClaims().accessExpiresAt ?? 0;
  const h = harness(saved(trialClaims()));
  const signals = createStartupSignals(false);
  const seen: boolean[] = [];
  signals.admission.onChange((value) => seen.push(value));
  const { status, acknowledge } = admissionRoutes(h.runtime, signals);
  const first = await status();
  expect(first).toMatchObject({ edition: 'pro', state: 'ready' });
  await acknowledge(first.admissionGeneration);
  // The trial ends during a long job, then the renderer runs out of memory and
  // the operator chooses Reload KerfDesk.
  h.clock(expiry * 1000 + 60_000);
  signals.admission.rendererGone();
  signals.admission.rendererOpening();
  const reloaded = await status();
  expect(reloaded).toMatchObject({
    edition: 'free',
    state: 'trial-expired',
    sessionAdmitted: true,
    admissionGeneration: first.admissionGeneration + 2,
  });
  // The reloaded workspace acknowledges like any other; only then do services resume.
  expect(seen).toEqual([false, true, false]);
  await acknowledge(reloaded.admissionGeneration);
  expect(seen).toEqual([false, true, false, true]);
  // The next launch has no admitted session, so the licence window stands again.
  const relaunched = await admissionRoutes(h.runtime).status();
  expect(relaunched).toMatchObject({ edition: 'free', state: 'trial-expired' });
  expect(relaunched.sessionAdmitted).toBeUndefined();
});

it('never reports a session admitted before a mounted workspace acknowledged one', async () => {
  const signals = createStartupSignals(false);
  const { status, acknowledge } = admissionRoutes(harness(saved()).runtime, signals);
  const stale = await status();
  // A Pro status alone, or an acknowledgement from a renderer that has since
  // reloaded, lets no later renderer past the licence window.
  signals.admission.rendererOpening();
  await acknowledge(stale.admissionGeneration);
  expect((await status()).sessionAdmitted).toBeUndefined();
});
