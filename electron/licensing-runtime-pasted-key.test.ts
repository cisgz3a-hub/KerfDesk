import { describe, expect, it } from 'vitest';
import { harness } from './licensing-runtime.test-support';

// Activation finds the key inside pasted text (ADR-579).
describe('activating with a pasted key', () => {
  const KEY = `KD1.0f8fad5b-d9cb-469f-a165-70867728950e.${'a'.repeat(43)}`;
  it('activates and saves the key found inside pasted text', async () => {
    const h = harness();
    expect(
      await h.runtime.activate(`Licence key:\n${KEY.slice(0, 40)}\n${KEY.slice(40)}`),
    ).toMatchObject({ state: 'ready', licenseKey: KEY });
    expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1].body)).licenseKey).toBe(KEY);
  });
  it('explains an unusable entry locally, and leaves any other key for the service to judge', async () => {
    const h = harness();
    expect((await h.runtime.activate('short')).message).toContain(
      'not a whole KerfDesk licence key',
    );
    expect(h.fetch).not.toHaveBeenCalled();
    // A partial or older-format key is sent unchanged; only the service can refuse a key.
    await h.runtime.activate(KEY.slice(0, 60));
    expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1].body)).licenseKey).toBe(KEY.slice(0, 60));
  });
});
