import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopBackgroundStartup } from '../../../electron/desktop-startup';
import { DesktopStartupGate } from '../app/DesktopStartupGate';
import { TermsAgreementGate } from './TermsAgreementGate';
import { TERMS_AGREEMENT_KEY } from './terms-agreement';
import type * as GeneratedTerms from './terms-text.generated';

vi.mock('./terms-text.generated', async (importOriginal) => ({
  ...(await importOriginal<typeof GeneratedTerms>()),
  TERMS_LAST_UPDATED: '12 October 2026',
}));
vi.mock('../app/desktop-close-runtime', () => ({
  installDesktopCloseReceiver: () => () => undefined,
}));

let host: HTMLDivElement;
let root: Root;
let start: ReturnType<typeof vi.fn<() => void>>;
let fetchReady: ReturnType<typeof vi.fn<(_url: string, init: RequestInit) => Promise<Response>>>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  vi.stubGlobal(
    'window',
    Object.create(window, { location: { value: new URL('app://app/index.html') } }),
  );
  start = vi.fn();
  const native = createDesktopBackgroundStartup(
    { config: { channel: 'commercial' }, start },
    {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      disableWebInstaller: false,
      checkForUpdatesAndNotify: vi.fn(async () => null),
    },
    { isPackaged: true, trustedUpdates: false },
  );
  const handle = native.routes(async () => new Response(null, { status: 404 }));
  fetchReady = vi.fn(async (_url: string, init: RequestInit) =>
    handle(new Request('app://app/api/desktop/workspace-ready', init)),
  );
  vi.stubGlobal('fetch', fetchReady);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open() {
  await act(async () =>
    root.render(
      <StrictMode>
        <TermsAgreementGate>
          <DesktopStartupGate>
            <span data-testid="workspace">Workspace</span>
          </DesktopStartupGate>
        </TermsAgreementGate>
      </StrictMode>,
    ),
  );
}
async function click(element: HTMLElement | undefined) {
  if (element === undefined) throw new Error('Expected agreement control');
  await act(async () => element.click());
}

describe('commercial native startup behind the first-use agreement', () => {
  it('does not refresh a saved licence before both confirmations and explicit agreement', async () => {
    await open();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    expect(fetchReady).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    await click(boxes[0]);
    expect(fetchReady).not.toHaveBeenCalled();
    await click(boxes[1]);
    expect(fetchReady).not.toHaveBeenCalled();
    await click(
      [...document.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Agree and continue',
      ),
    );
    expect(start).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();
  });

  it.each([
    ['current acceptance', { version: '1.0', agreedAt: '2026-10-01T00:00:00Z' }],
    [
      'earlier terms explicitly retained',
      { version: '0.9', agreedAt: '2026-09-01T00:00:00Z', keptEarlier: '1.0' },
    ],
  ])('starts once when reopening with %s', async (_label, record) => {
    localStorage.setItem(TERMS_AGREEMENT_KEY, JSON.stringify(record));
    await open();
    expect(document.querySelector('[data-terms-agreement="first"]')).toBeNull();
    expect(start).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();
  });

  it('lets a returning user keep earlier terms without stopping their existing workspace', async () => {
    localStorage.setItem(
      TERMS_AGREEMENT_KEY,
      JSON.stringify({ version: '0.9', agreedAt: '2026-09-01T00:00:00Z' }),
    );
    await open();
    expect(start).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-terms-agreement="changed"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();
    await click(
      [...document.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Keep my earlier terms',
      ),
    );
    expect(start).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-terms-agreement="changed"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(TERMS_AGREEMENT_KEY) ?? '{}')).toMatchObject({
      version: '0.9',
      keptEarlier: '1.0',
    });
  });
});
