// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { updateStatusText } from '../src/ui/licensing/update-status-text';
import { createLicensingRuntime } from './licensing-runtime';
import type { LicenceClaims } from './licensing-verification';
import { createManualUpdates } from './manual-update';
import {
  claims,
  envelope,
  grant,
  harness,
  keys,
  NOW,
  saved,
  trialClaims,
} from './licensing-runtime.test-support';

// Rolling audit v4 H10-P2-1: a failed licence confirmation still holds a paid
// or trial update back (ADR-561 item 5), but the update panel must not say the
// licence's updates ended on a date still to come (ADR-547 Amendment 1).

const DAY = 86_400;
const bytes = Buffer.from('synthetic installer');
const latest = JSON.stringify(
  envelope(
    {
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      kind: 'manual-download',
      channel: 'stable',
      version: '1.0.1',
      sourceSha: 'b'.repeat(40),
      sourceRef: 'refs/heads/main',
      publishedAt: '2026-09-27T00:00:00.000Z',
      codeSigning: 'unsigned',
      updates: 'manual',
      artifacts: [
        {
          name: 'KerfDesk-1.0.1-windows-x64-setup.exe',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ],
    },
    true,
  ),
);
const FAILURES = {
  offline: () => Promise.reject(new TypeError('fetch failed')),
  'a 503': () =>
    Promise.resolve(Response.json({ error: { code: 'unavailable' } }, { status: 503 })),
  'a 429 rate limit': () =>
    Promise.resolve(Response.json({ error: { code: 'rate_limited' } }, { status: 429 })),
};
const ENDED = NOW / 1000 - 30 * DAY;
const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (dirname(folder) !== tmpdir()) throw new Error('Unexpected test directory');
    await rm(folder, { recursive: true, force: true });
  }
});

/** The real licence runtime and manual update service, wired as desktop-licensing.ts wires them. */
async function desktop(rights: LicenceClaims, confirmedDaysAgo: number) {
  const h = harness({ ...saved(rights), refreshedAt: NOW / 1000 - confirmedDaysAgo * DAY });
  const runtime = createLicensingRuntime({
    ...h.options,
    config: { ...h.options.config, manualUpdates: true },
  });
  const folder = await mkdtemp(join(tmpdir(), 'kerfdesk-update-confirmation-'));
  folders.push(folder);
  let downloadsOnline = true;
  const updates = createManualUpdates({
    currentVersion: '1.0.0',
    currentPublishedAt: Date.parse('2026-09-01T00:00:00.000Z'),
    userDataPath: folder,
    keys,
    fetch: async (url) => {
      if (!downloadsOnline) throw new TypeError('fetch failed');
      return url.endsWith('latest.json') ? new Response(latest) : new Response('', { status: 404 });
    },
    eligible: runtime.isManualReleaseEligible,
    awaitsConfirmation: runtime.isManualReleaseAwaitingConfirmation,
    now: () => NOW,
  });
  /** Check now: what the update panel then says. */
  const check = async () => {
    updates.check();
    await updates.settled();
    const licence = await runtime.status();
    const status = updates.status();
    return {
      state: status.state,
      text: updateStatusText(status, licence.updatesUntil, () => '09:15', NOW),
      licence,
    };
  };
  return {
    fetch: h.fetch,
    runtime,
    check,
    /** `start()` in desktop-licensing.ts: a quiet confirmation, then the update check. */
    launch: async () => {
      await runtime.status();
      await runtime.refreshInBackground();
      return check();
    },
    downloadsOnline: (online: boolean) => {
      downloadsOnline = online;
    },
  };
}

describe('a failed licence confirmation and the update panel (ADR-547 Amendment 1)', () => {
  it.each(Object.entries(FAILURES))(
    'holds a covered paid update back after %s, and says the licence could not be confirmed',
    async (_failure, reply) => {
      const app = await desktop(claims(), 8);
      app.fetch.mockImplementation(reply);
      const result = await app.launch();
      // Only the synthetic licence service was asked, never the production one.
      expect(app.fetch).toHaveBeenCalledOnce();
      expect(app.fetch.mock.calls[0]?.[0]).toMatch(/^https:\/\/licensing\.example\//);
      expect(result.state).toBe('licence-unconfirmed');
      expect(result.text).toContain('KerfDesk 1.0.1 is out and your licence covers it');
      expect(result.text).toContain("couldn't confirm your licence just now");
      expect(result.text).toContain('choose Refresh licence');
      expect(result.text).not.toContain('ended');
      // Help > Licence keeps naming the same update period the panel says covers it.
      expect(result.licence).toMatchObject({ edition: 'pro', updatesUntil: claims().updatesUntil });
    },
  );

  it('holds an active trial update back the same way', async () => {
    const app = await desktop(trialClaims(), 2);
    app.fetch.mockImplementation(FAILURES.offline);
    expect((await app.launch()).state).toBe('licence-unconfirmed');
  });

  it('offline at launch, then Check now: names the confirmation, and Refresh licence clears it', async () => {
    const app = await desktop(claims(), 8);
    app.fetch.mockImplementation(FAILURES.offline);
    app.downloadsOnline(false);
    const offline = await app.launch();
    expect(offline.state).toBe('failed');
    expect(offline.text).toContain('try Check now again');

    app.downloadsOnline(true);
    const reconnected = await app.check();
    expect(reconnected.state).toBe('licence-unconfirmed');
    expect(reconnected.text).not.toContain('ended');

    app.fetch.mockReset();
    app.fetch.mockResolvedValueOnce(grant(claims()));
    await app.runtime.refresh();
    expect((await app.check()).state).toBe('available');
  });

  it('still names the date when the update year has ended', async () => {
    const app = await desktop(claims({ updatesUntil: ENDED }), 1);
    const result = await app.launch();
    expect(app.fetch).not.toHaveBeenCalled();
    expect(result.state).toBe('not-covered');
    expect(result.text).toContain(
      `your licence's updates ended on ${new Date(ENDED * 1000).toLocaleDateString()}.`,
    );
  });

  it('keeps a release the licence does not cover not covered when the confirmation also fails', async () => {
    const app = await desktop(claims({ updatesUntil: ENDED }), 8);
    app.fetch.mockImplementation(FAILURES['a 503']);
    const result = await app.launch();
    expect(app.fetch).toHaveBeenCalledOnce();
    expect(result.state).toBe('not-covered');
    expect(result.text).toContain(`ended on ${new Date(ENDED * 1000).toLocaleDateString()}.`);
  });

  it('offers a covered update when no confirmation is due', async () => {
    const app = await desktop(claims(), 1);
    expect((await app.launch()).state).toBe('available');
    expect(app.fetch).not.toHaveBeenCalled();
  });
});
