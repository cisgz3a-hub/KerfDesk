import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DesktopLicenceAdapter, DesktopLicenceStatus } from '../../platform/types';
import { CommercialLicenceGate, LICENCE_SETTINGS_EVENT } from './CommercialLicenceGate';

const initial: DesktopLicenceStatus = {
  channel: 'commercial',
  state: 'activation-required',
  sessionAuthorized: false,
  tier: null,
  accessExpiresAt: null,
  updatesUntil: null,
  perpetualUpdates: false,
  deactivationPending: false,
  paymentPending: false,
  message: null,
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
function client(status: DesktopLicenceStatus = initial): DesktopLicenceAdapter {
  return {
    status: vi.fn(async () => status),
    activate: vi.fn(async () => status),
    startTrial: vi.fn(async () => status),
    refresh: vi.fn(async () => status),
    deactivate: vi.fn(async () => status),
    launch: vi.fn(async () => ({ ...status, sessionAuthorized: true })),
    checkout: vi.fn(async () => ({ ...status, paymentPending: true })),
    claimPayment: vi.fn(async () => status),
  };
}
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((value) =>
    value.textContent?.includes(text),
  );
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}

it('keeps free/browser builds accessible without a licence adapter', async () => {
  await act(async () =>
    root.render(
      <CommercialLicenceGate>
        <div data-workspace>workspace</div>
      </CommercialLicenceGate>,
    ),
  );
  expect(host.textContent).toBe('workspace');
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it('shows free desktop edition information without commercial actions from Help', async () => {
  const api = client({ ...initial, channel: 'free', state: 'ready', sessionAuthorized: true });
  await act(async () =>
    root.render(
      <CommercialLicenceGate client={api}>
        <div data-workspace>workspace</div>
      </CommercialLicenceGate>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(host.textContent).toContain('Free desktop edition');
  expect(host.textContent).toContain('No licence or activation is required');
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).not.toContain('Buy licence');
  expect(host.textContent).not.toContain('Start free');
  expect(api.launch).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.textContent).toBe('workspace');
});
it('does not mount the workspace until main admits the commercial session', async () => {
  const api = client();
  await act(async () =>
    root.render(
      <CommercialLicenceGate client={api}>
        <div data-workspace>workspace</div>
      </CommercialLicenceGate>,
    ),
  );
  expect(host.querySelector('[data-licence-gate]')).not.toBeNull();
  expect(host.querySelector('[data-workspace]')).toBeNull();
  expect(api.launch).not.toHaveBeenCalled();
  await act(async () => button('Start free 30-day trial').click());
  expect(api.startTrial).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-workspace]')).toBeNull();
});
it('never unmounts an admitted workspace when expiry or deactivation is reported', async () => {
  const api = client({ ...initial, state: 'ready', tier: 'trial' });
  const unmount = vi.fn();
  function Workspace() {
    useEffect(() => unmount, []);
    return <div data-workspace>workspace</div>;
  }
  await act(async () =>
    root.render(
      <CommercialLicenceGate client={api}>
        <Workspace />
      </CommercialLicenceGate>,
    ),
  );
  expect(host.textContent).toBe('workspace');
  expect(api.launch).toHaveBeenCalledOnce();
  vi.mocked(api.status).mockResolvedValue({
    ...initial,
    state: 'trial-expired',
    sessionAuthorized: true,
    tier: 'trial',
  });
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(host.textContent).toContain('workspace');
  expect(host.textContent).toContain('Your KerfDesk licence');
  await act(async () => button('Deactivate this device').click());
  expect(host.textContent).toContain('workspace');
  expect(unmount).not.toHaveBeenCalled();
  await act(async () => button('Close').click());
  expect(host.textContent).toBe('workspace');
});
it('shows pending payment recovery without granting a browser-confirmed licence', async () => {
  const api = client();
  await act(async () =>
    root.render(
      <CommercialLicenceGate client={api}>
        <div data-workspace>workspace</div>
      </CommercialLicenceGate>,
    ),
  );
  await act(async () => button('Buy licence').click());
  expect(api.checkout).toHaveBeenCalledWith('purchase');
  expect(host.textContent).toContain('Check payment');
  expect(api.launch).not.toHaveBeenCalled();
  expect(host.querySelector('[data-workspace]')).toBeNull();
});
it('shows developer lifetime rights with no purchase or renewal prompt', async () => {
  const api = client({ ...initial, state: 'ready', tier: 'developer', perpetualUpdates: true });
  await act(async () =>
    root.render(
      <CommercialLicenceGate client={api}>
        <div data-workspace>workspace</div>
      </CommercialLicenceGate>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(host.textContent).toContain('Permanent access and updates');
  expect(host.textContent).not.toContain('Buy licence');
  expect(host.textContent).not.toContain('Renew updates');
});
