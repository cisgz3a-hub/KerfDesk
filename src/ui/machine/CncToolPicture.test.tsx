import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { BIT_PHOTO_ASSETS } from '../tutorials/bit-photo-assets';
import { AddCncBitForm } from './AddCncBitForm';
import { CncBitCatalogPanel } from './CncBitCatalogPanel';
import { CncToolPicture } from './CncToolPicture';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});

async function togglePicture(open: boolean, container: ParentNode = host): Promise<void> {
  const details = container.querySelector('[data-cnc-tool-picture]');
  if (!(details instanceof HTMLDetailsElement)) throw new Error('Picture disclosure missing');
  await act(async () => {
    details.open = open;
    details.dispatchEvent(new Event('toggle'));
  });
}

describe('CncToolPicture', () => {
  it('audit catalog manufacturer source disclosures open and close without changing tools', async () => {
    const onAdd = vi.fn();
    const project = useStore.getState().project;
    const library = useStore.getState().cncLibrary;
    await act(async () => root.render(<CncBitCatalogPanel customTools={[]} onAdd={onAdd} />));
    const summaries = [
      ...host.querySelectorAll<HTMLElement>(
        'summary[title="Show the primary manufacturer source URL."]',
      ),
    ];
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      const details = summary.parentElement as HTMLDetailsElement;
      expect(details.open).toBe(false);
      act(() => summary.click());
      expect(details.open).toBe(true);
      expect(details.querySelector('code')?.textContent).toMatch(/^https:\/\//);
      act(() => summary.click());
      expect(details.open).toBe(false);
    }
    expect(onAdd).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().cncLibrary).toBe(library);
  });

  it('audit picture summary clicks mount and hide the selected photo without changing the project', async () => {
    const project = useStore.getState().project;
    await act(async () =>
      root.render(<CncToolPicture tool={{ kind: 'end-mill', family: 'upcut' }} />),
    );
    const details = host.querySelector<HTMLDetailsElement>('[data-cnc-tool-picture]')!;
    const summary = details.querySelector('summary')!;
    expect(details.open).toBe(false);
    expect(host.querySelector('img')).toBeNull();
    await act(async () => {
      summary.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(details.open).toBe(true);
    expect(host.querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-upcut'].small.file,
    );
    await act(async () => {
      summary.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(details.open).toBe(false);
    expect(host.querySelector('img')).toBeNull();
    expect(useStore.getState().project).toBe(project);
  });

  it('mounts only the requested photo, unmounts on close, and leaves project and tool state intact', async () => {
    const project = useStore.getState().project;
    const library = useStore.getState().cncLibrary;
    await act(async () =>
      root.render(<CncToolPicture tool={{ kind: 'end-mill', family: 'upcut' }} />),
    );
    expect(host.querySelector('img')).toBeNull();

    await togglePicture(true);
    const image = host.querySelector('img');
    expect(image?.getAttribute('src')).toContain(BIT_PHOTO_ASSETS['bit-upcut'].small.file);
    expect(image?.getAttribute('srcset')).toContain(BIT_PHOTO_ASSETS['bit-upcut'].large.file);
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.getAttribute('alt')).toContain('Generic illustration');
    expect(host.textContent).toContain('not an exact catalog product');

    await togglePicture(false);
    expect(host.querySelector('img')).toBeNull();
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().cncLibrary).toBe(library);
  });

  it('retains teaching after an image failure and recovers when the selected family changes', async () => {
    await act(async () =>
      root.render(<CncToolPicture initiallyOpen tool={{ kind: 'end-mill', family: 'downcut' }} />),
    );
    const failedImage = host.querySelector('img');
    if (failedImage === null) throw new Error('Initial picture missing');
    await act(async () => failedImage.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('Picture unavailable');
    expect(host.textContent).toContain('directs chips toward the tip');

    await act(async () =>
      root.render(
        <CncToolPicture initiallyOpen tool={{ kind: 'ball-nose', family: 'o-flute-ball-nose' }} />,
      ),
    );
    expect(host.querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-o-flute-ball-nose'].small.file,
    );
    expect(host.textContent).not.toContain('Picture unavailable');
  });

  it('shows the new custom bit kind after selection without filling dimensions or saving a tool', async () => {
    const onAdd = vi.fn();
    await act(async () => root.render(<AddCncBitForm onAdd={onAdd} />));
    expect(host.querySelector('img')).toBeNull();
    const kind = host.querySelector('[aria-label="New bit kind"]');
    if (!(kind instanceof HTMLSelectElement)) throw new Error('Bit kind selector missing');
    await act(async () => {
      kind.value = 'engraving';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-engraving-point'].small.file,
    );
    const tip = host.querySelector('[aria-label="New bit tip flat diameter (mm)"]');
    if (!(tip instanceof HTMLInputElement)) throw new Error('Tip diameter input missing');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(tip, '0.2');
      tip.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-engraving-flat'].small.file,
    );
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="New bit diameter (mm)"]')?.value,
    ).toBe('');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('does not load the catalog pictures until a family is expanded', async () => {
    const onAdd = vi.fn();
    await act(async () => root.render(<CncBitCatalogPanel customTools={[]} onAdd={onAdd} />));
    expect(host.querySelectorAll('[data-cnc-tool-picture]')).toHaveLength(13);
    expect(host.querySelector('img')).toBeNull();
    const oBall = host.querySelector(
      '[data-cnc-tool-picture="bit-o-flute-ball-nose"]',
    )?.parentElement;
    if (oBall === null || oBall === undefined) throw new Error('O-flute ball family missing');
    await togglePicture(true, oBall);
    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(host.querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-o-flute-ball-nose'].small.file,
    );
    expect(onAdd).not.toHaveBeenCalled();
    expect(
      host.querySelector('[aria-label="Reference-only cutter families"] [data-cnc-tool-picture]'),
    ).toBeNull();
  });
});
