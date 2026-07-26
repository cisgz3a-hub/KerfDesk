import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { JobTimeBadge } from './JobTimeBadge';

// React exposes this test-only switch without shipping it in the DOM lib.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type MountedBadge = { readonly host: HTMLElement; readonly root: Root };

const mountedBadges: MountedBadge[] = [];

afterEach(() => {
  for (const mounted of mountedBadges.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.host.remove();
  }
});

function render(state: Parameters<typeof JobTimeBadge>[0]['state']): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mountedBadges.push({ host, root });
  act(() => root.render(<JobTimeBadge state={state} />));
  return host;
}

describe('JobTimeBadge', () => {
  it('shows live remaining time without mixing in acknowledged lines', () => {
    const host = render({ kind: 'running', remainingSeconds: 83 });
    expect(host.textContent).toBe('~1m 23s remaining');
    expect(host.textContent).not.toContain('lines');
  });

  it('labels every non-running state without fabricating progress', () => {
    expect(render({ kind: 'estimating', remainingSeconds: 83 }).textContent).toBe(
      'Estimating · ~1m 23s remaining',
    );
    expect(render({ kind: 'paused', remainingSeconds: 83 }).textContent).toBe(
      'Paused · ~1m 23s remaining',
    );
    expect(render({ kind: 'disconnected' }).textContent).toBe(
      'Time remaining unavailable · disconnected',
    );
    expect(render({ kind: 'finishing' }).textContent).toBe(
      'Machine finishing · waiting for controller',
    );
    expect(render({ kind: 'complete' }).textContent).toBe('Complete');
    expect(render({ kind: 'unavailable', reason: 'route uncertain' }).textContent).toBe(
      'Time remaining unavailable · route uncertain',
    );
  });
});
