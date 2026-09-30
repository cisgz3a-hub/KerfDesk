import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { LicenceAdapter } from '../../platform/types';
import { EditionProvider } from './EditionProvider';
import { proFeaturesUnlocked, requestProFeature, setActiveEdition, useEdition } from './edition';

vi.mock('../../platform/build-capabilities', () => ({ BROWSER_FREE_BUILD: true }));

afterEach(() => {
  setActiveEdition(null);
  vi.unstubAllGlobals();
});

it('starts and resets the browser build as Free before a provider mounts', () => {
  const open = vi.fn();
  expect(proFeaturesUnlocked()).toBe(false);
  expect(requestProFeature('vcarve', open)).toBe(false);
  expect(open).not.toHaveBeenCalled();
  setActiveEdition(null);
  expect(proFeaturesUnlocked()).toBe(false);
});

it('ignores unrestricted overrides and desktop clients in a browser build', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const status = vi.fn();
  const client = { status } as unknown as LicenceAdapter;
  const opened = vi.fn();
  const duringMount: boolean[] = [];
  function Workspace(): JSX.Element {
    const edition = useEdition();
    useEffect(() => {
      duringMount.push(requestProFeature('vcarve', opened));
    }, []);
    return <span>{edition.pro ? 'Pro workspace' : 'Free workspace'}</span>;
  }
  try {
    await act(async () =>
      root.render(
        <EditionProvider client={client} unlicensedRunsFree={false}>
          <Workspace />
        </EditionProvider>,
      ),
    );
    expect(host.textContent).toContain('Free workspace');
    expect(status).not.toHaveBeenCalled();
    expect(duringMount).toEqual([false]);
    expect(opened).not.toHaveBeenCalled();
    expect(proFeaturesUnlocked()).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  expect(proFeaturesUnlocked()).toBe(false);
});
