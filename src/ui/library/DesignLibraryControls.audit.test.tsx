import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { button, change, click, input, mount } from '../layers/control-audit-test-support';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { DesignLibraryDialog } from './DesignLibraryDialog';

async function openLibrary() {
  useUiStore.setState({ libraryDialogOpen: true });
  return mount(<DesignLibraryDialog />);
}
async function search(host: HTMLElement, value: string) {
  await act(async () => {
    const field = input(host, 'input[aria-label="Search design library"]');
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('artwork control audit: design library navigation', () => {
  it('filters a collection returns to All designs and clears search and all facets', async () => {
    const host = await openLibrary();
    const collections = host.querySelectorAll<HTMLButtonElement>('.lf-library-collection');
    const all = collections[0]!;
    const category = collections[1]!;
    const categoryText = category.querySelector('span')!.textContent;
    await click(category);
    expect(category.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.lf-library-detail__eyebrow')?.textContent).toBe(categoryText);
    const count = host.querySelectorAll('[data-library-card]').length;
    await click(all);
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[data-library-card]').length).toBeGreaterThanOrEqual(count);
    await search(host, 'no-such-audit-design');
    expect(host.querySelectorAll('[data-library-card]')).toHaveLength(0);
    await click(button(host, 'Clear search'));
    expect(input(host, '[aria-label="Search design library"]').value).toBe('');
    expect(host.querySelectorAll('[data-library-card]').length).toBeGreaterThan(0);
    await click(button(host, 'Filters'));
    expect(host.querySelector('#library-filter-panel')).not.toBeNull();
    await change(
      host.querySelector<HTMLSelectElement>('select[aria-label="Machine filter"]')!,
      'cnc',
    );
    await click(button(host, 'Clear all filters'));
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="Machine filter"]')?.value,
    ).toBe('all');
    await click(button(host, 'Filters'));
    expect(host.querySelector('#library-filter-panel')).toBeNull();
  });

  it('returns focus from details to the selected card without inserting artwork', async () => {
    const host = await openLibrary();
    await search(host, 'kerf');
    const card = button(host, 'View details for Kerf Comb');
    card.scrollIntoView = vi.fn(); // jsdom has focus but no layout/scroll implementation.
    await click(card);
    const before = useStore.getState().project;
    const back = [...host.querySelectorAll<HTMLButtonElement>('button')].find((element) =>
      element.textContent?.includes('Back to designs'),
    )!;
    await click(back);
    expect(document.activeElement).toBe(card);
    expect(card.scrollIntoView).toHaveBeenCalledOnce();
    expect(useStore.getState().project).toBe(before);
  });

  it('exposes exact source and license destinations as native new-tab links', async () => {
    const host = await openLibrary();
    await search(host, 'moon & stars');
    await click(button(host, 'View details for Moon & Stars'));
    const links = [...host.querySelectorAll<HTMLAnchorElement>('.lf-library-detail__links a')];
    expect(links.map((link) => link.textContent)).toEqual(['View source', 'License terms']);
    expect(links[0]?.href).toContain('github.com/tabler/tabler-icons/blob/');
    expect(links[0]?.href).toContain('moon-stars.svg');
    expect(links[1]?.href).toContain('LICENSE');
    expect(links.every((link) => link.target === '_blank' && link.rel === 'noreferrer')).toBe(true);
  });
});
