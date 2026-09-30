import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeLicenceRendererSource } from './native-smoke-licence-renderer.js';
import type { NativeLicencePhase } from './native-smoke-licence-config.js';

// Test the additional phase UI independently of the existing import/save smoke.
vi.mock('./native-smoke-renderer.js', () => ({
  RENDERER_SMOKE_SOURCE: 'Promise.resolve({licensing:{kind:"observed",updateState:"unavailable"}})',
}));
const free = {
  channel: 'commercial',
  state: 'activation-required',
  edition: 'free',
  tier: null,
  perpetualUpdates: false,
  accessExpiresAt: null,
  updatesUntil: null,
  deactivationPending: false,
};
const pro = { ...free, state: 'ready', edition: 'pro', tier: 'developer', perpetualUpdates: true };
const key = `KD1.test.${'a'.repeat(43)}`;
afterEach(() => {
  document.body.replaceChildren();
});

function fixture(initial: typeof free) {
  let status = initial;
  let submitted = '';
  let studioOpened = false;
  const edition = document.createElement('button');
  const update = () => {
    edition.setAttribute(
      'aria-label',
      `Edition: ${status.edition === 'pro' ? 'Pro' : 'Free'}. Open licence settings`,
    );
  };
  update();
  edition.onclick = () => {
    const panel = document.createElement('section');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'KerfDesk licence');
    panel.innerHTML =
      '<input id="kerfdesk-licence-key" type="password"><button disabled>Activate licence</button><button>Deactivate this device</button><button aria-label="Close licence settings">Close</button>';
    const input = panel.querySelector('input')!;
    const buttons = panel.querySelectorAll('button');
    input.addEventListener('input', () => {
      buttons[0]!.disabled = input.value.length < 8;
    });
    buttons[0]!.onclick = () => {
      submitted = input.value;
      status = pro;
      update();
    };
    buttons[1]!.onclick = () => {
      status = free;
      update();
    };
    buttons[2]!.onclick = () => panel.remove();
    document.body.append(panel);
  };
  const studio = document.createElement('button');
  studio.setAttribute('aria-label', 'Open Design Studio');
  studio.onclick = () => {
    if (status.edition !== 'pro') return;
    studioOpened = true;
    const dialog = document.createElement('section');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Design Studio');
    const close = document.createElement('button');
    close.title = 'Close the Studio (Esc)';
    close.onclick = () => dialog.remove();
    dialog.append(close);
    document.body.append(dialog);
  };
  document.body.append(edition, studio);
  const fetch = vi.fn(async (_url, options) => {
    expect(options).toMatchObject({ method: 'GET', headers: { 'X-KerfDesk-Licensing': '1' } });
    return Response.json(status);
  });
  return { fetch, submitted: () => submitted, studioOpened: () => studioOpened };
}

function execute(phase: NativeLicencePhase, fetch: ReturnType<typeof fixture>['fetch']) {
  return runInNewContext(nativeLicenceRendererSource(phase, phase === 'activate' ? key : ''), {
    location: { href: 'app://app/index.html' },
    document,
    HTMLInputElement,
    HTMLButtonElement,
    Event,
    fetch,
    setTimeout,
  });
}

describe('native qualification uses normal UI controls', () => {
  it('enters the password input, clicks activation, and opens the actual Pro dialog', async () => {
    const ui = fixture(free);
    const result = await execute('activate', ui.fetch);
    expect(ui.submitted()).toBe(key);
    expect(ui.studioOpened()).toBe(true);
    expect(result.licenceQualification).toMatchObject({
      phase: 'activate',
      before: free,
      after: pro,
      proAction: 'design-studio-opened',
    });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(ui.fetch.mock.calls.every(([url]) => url === 'app://app/api/licensing/status')).toBe(
      true,
    );
  });

  it('verifies the persisted Pro UI without reactivation', async () => {
    const ui = fixture(pro);
    const result = await execute('offline', ui.fetch);
    expect(ui.submitted()).toBe('');
    expect(result.licenceQualification).toMatchObject({
      before: pro,
      after: pro,
      proAction: 'design-studio-opened',
    });
  });

  it('uses device deactivation and accepts only a returned Free state', async () => {
    const ui = fixture(pro);
    const result = await execute('deactivate', ui.fetch);
    expect(result.licenceQualification.after).toEqual(free);
    expect(ui.studioOpened()).toBe(false);
  });

  it('refuses activation over an existing Pro profile and offline proof from Free', async () => {
    await expect(execute('activate', fixture(pro).fetch)).rejects.toThrow('initially Free');
    document.body.replaceChildren();
    await expect(execute('offline', fixture(free).fetch)).rejects.toThrow(
      'did not retain developer Pro',
    );
  });
});
