import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeLicenceRendererSource } from './native-smoke-licence-renderer.js';
import type { NativeLicencePhase } from './native-smoke-licence-config.js';
import { DESKTOP_LICENCE_WINDOW } from './licence-window.js';

// Test the additional phase UI independently of the existing import/save smoke.
vi.mock('./native-smoke-renderer.js', () => ({
  RENDERER_SMOKE_SOURCE: 'Promise.resolve({licensing:{kind:"observed",updateState:"unavailable"}})',
  // The real probe polls; this fixture's DOM is already settled.
  RENDERER_WORKSPACE_READY_SOURCE:
    'Promise.resolve(document.querySelector(\'header[aria-label="Toolbar"]\') === null && document.querySelector(\'[aria-label="Activate KerfDesk"]\') !== null ? "licence-window" : "workspace")',
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

function fixture(initial: typeof free, licenceWindow = true) {
  let status = initial;
  let submitted = '';
  let studioOpened = false;
  // The workspace's edition control exists only once the window lets the profile in
  // (ADR-623), or from the start while Amendment 3 holds the window off.
  const edition = document.createElement('button');
  const freeLabel = licenceWindow ? 'Licence needed' : 'Free · Try Pro';
  const update = () => {
    edition.setAttribute(
      'aria-label',
      `Edition: ${status.edition === 'pro' ? 'Pro' : freeLabel}. Open licence settings`,
    );
  };
  update();
  const keyForm = (container: HTMLElement) => {
    container.innerHTML =
      '<input id="kerfdesk-licence-key" type="text"><button disabled>Activate licence</button><button>Deactivate this device</button><button aria-label="Close licence settings">Close</button>';
    const input = container.querySelector('input')!;
    const buttons = container.querySelectorAll('button');
    input.addEventListener('input', () => {
      buttons[0]!.disabled = input.value.length < 8;
    });
    buttons[0]!.onclick = () => {
      submitted = input.value;
      status = pro;
      update();
      gate.remove();
      document.body.append(edition, studio);
    };
    buttons[1]!.onclick = () => {
      status = free;
      update();
    };
    buttons[2]!.onclick = () => container.remove();
  };
  const gate = document.createElement('section');
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-label', 'Activate KerfDesk');
  gate.setAttribute('data-licence-state', 'activation-required');
  keyForm(gate);
  edition.onclick = () => {
    const panel = document.createElement('section');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'KerfDesk licence');
    keyForm(panel);
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
  if (status.edition === 'pro' || !licenceWindow) document.body.append(edition, studio);
  else document.body.append(gate);
  const fetch = vi.fn(async (_url, options) => {
    expect(options).toMatchObject({ method: 'GET', headers: { 'X-KerfDesk-Licensing': '1' } });
    return Response.json(status);
  });
  return { fetch, submitted: () => submitted, studioOpened: () => studioOpened };
}

function execute(
  phase: NativeLicencePhase,
  fetch: ReturnType<typeof fixture>['fetch'],
  licenceWindow = true,
) {
  const source = nativeLicenceRendererSource(phase, phase === 'activate' ? key : '', licenceWindow);
  return runInNewContext(source, {
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

  it('refuses activation when the workspace opened behind the licence window', async () => {
    const ui = fixture(free);
    const toolbar = document.createElement('header');
    toolbar.setAttribute('aria-label', 'Toolbar');
    document.body.append(toolbar);
    await expect(execute('activate', ui.fetch)).rejects.toThrow('without the licence window');
    expect(ui.submitted()).toBe('');
  });

  it('activates from Help > Licence in KerfDesk Free while the window is held off', async () => {
    // ADR-623 Amendment 3: the unlicensed profile opens its workspace, as 1.0.20 did.
    const ui = fixture(free, false);
    const result = await execute('activate', ui.fetch, false);
    expect(ui.submitted()).toBe(key);
    expect(ui.studioOpened()).toBe(true);
    expect(document.querySelector('[aria-label="KerfDesk licence"]')).toBeNull();
    expect(result.licenceQualification).toMatchObject({ before: free, after: pro });
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('refuses activation behind a licence window that is held off', async () => {
    const ui = fixture(free);
    await expect(execute('activate', ui.fetch, false)).rejects.toThrow('held off');
    expect(ui.submitted()).toBe('');
  });

  it('follows the shared licence window setting by default', () => {
    const source = nativeLicenceRendererSource('offline', '');
    expect(source.endsWith(`, ${String(DESKTOP_LICENCE_WINDOW)})`)).toBe(true);
  });

  it('refuses activation over an existing Pro profile and offline proof from Free', async () => {
    await expect(execute('activate', fixture(pro).fetch)).rejects.toThrow('initially unlicensed');
    document.body.replaceChildren();
    await expect(execute('offline', fixture(free).fetch)).rejects.toThrow(
      'did not retain developer Pro',
    );
  });
});
