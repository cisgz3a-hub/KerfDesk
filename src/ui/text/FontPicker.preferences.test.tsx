import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { clickControl, mountControl } from '../image-editor/control-audit-test-support';
import { FontPicker } from './FontPicker';
import { useFontPreferences } from './font-preferences-store';

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: async () => undefined,
}));

beforeEach(() => {
  localStorage.clear();
  useFontPreferences.setState({ favourites: [], hidden: [], recent: [], specimenPx: 18 });
});

function fontNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>('button[data-font-key]')].map(
    (button) => button.dataset['fontKey'] ?? '',
  );
}

async function press(label: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`${label} missing`);
  await act(async () => button.click());
}

async function view(name: string): Promise<void> {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('.lf-font-picker-views button'),
  ].find((candidate) => candidate.textContent === name);
  await act(async () => button?.click());
}

it('keeps favourites, hides fonts from the list and remembers recent choices', async () => {
  const change = vi.fn();
  const host = await mountControl(<FontPicker value="roboto-regular" onChange={change} />);
  await clickControl(host, 'Font');
  const all = fontNames();
  expect(all).toContain('great-vibes-regular');

  await press('Add Great Vibes to favourites');
  await view('Favourites');
  expect(fontNames()).toEqual(['great-vibes-regular']);

  await view('All');
  await press('Hide Great Vibes from the list');
  expect(fontNames()).not.toContain('great-vibes-regular');
  await view('Hidden');
  expect(fontNames()).toEqual(['great-vibes-regular']);

  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[data-font-key="great-vibes-regular"]')
      ?.click(),
  );
  expect(change).toHaveBeenCalledWith('great-vibes-regular');
  expect(useFontPreferences.getState().recent[0]).toBe('great-vibes-regular');
  expect(JSON.parse(localStorage.getItem('lf2:font-preferences:v1') ?? '{}').favourites).toEqual([
    'great-vibes-regular',
  ]);
});
