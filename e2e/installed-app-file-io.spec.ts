import { expect, test, type Page } from '@playwright/test';
import { showRunOrder } from '../scripts/installed-app-file-io.mjs';

async function renderPanels(page: Page, outerLabel: string | null, duplicateOuter = false) {
  // These nested tablists reproduce the roles and names in WorkspaceSidePanels,
  // ArtworkPanelTabs and ArtworkEditorTabs after importing selected artwork.
  const outerTab = `<button id="outer-artwork" role="tab" aria-label="${outerLabel}">Artwork icon</button>`;
  await page.setContent(`
    <section aria-label="Workspace side panels">
      ${
        outerLabel === null
          ? ''
          : `<div role="tablist" aria-label="Side panel">
        ${outerTab}${duplicateOuter ? outerTab.replace('outer-artwork', 'duplicate-artwork') : ''}
        <button role="tab">Machine</button>
      </div>`
      }
      <div role="tablist" aria-label="Artwork panel view">
        <button role="tab">Settings</button>
        <button id="run-order" role="tab">Run order</button>
      </div>
      <div role="tablist" aria-label="Edit artwork or operation">
        <button role="tab">Operation</button>
        <button id="inner-artwork" role="tab" title="Edit size, shape and artwork adjustments">Artwork</button>
      </div>
    </section>
    <output aria-label="Activated tabs"></output>
  `);
  await page.evaluate(() => {
    document.addEventListener('click', (event) => {
      const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
      const output = document.querySelector('output');
      if (tab !== null && output !== null) output.textContent += `${tab.id},`;
    });
  });
}

for (const label of ['Artwork', 'Cuts / Layers']) {
  test(`installed qualification selects outer ${label} before Run order`, async ({ page }) => {
    await renderPanels(page, label);
    // Reproduce the strict-mode failure of the original region-wide selector.
    const unscopedArtwork = page
      .getByRole('region', { name: 'Workspace side panels', exact: true })
      .getByRole('tab', { name: /^(Artwork|Cuts \/ Layers)$/ });
    await expect(unscopedArtwork.isVisible()).rejects.toThrow(/strict mode violation/);

    await showRunOrder(page);

    await expect(page.getByRole('status', { name: 'Activated tabs' })).toHaveText(
      'outer-artwork,run-order,',
    );
  });
}

test('installed qualification opens Run order directly in the stacked side panel layout', async ({
  page,
}) => {
  await renderPanels(page, null);

  await showRunOrder(page);

  await expect(page.getByRole('status', { name: 'Activated tabs' })).toHaveText('run-order,');
});

test('installed qualification still refuses ambiguous outer Artwork tabs', async ({ page }) => {
  await renderPanels(page, 'Artwork', true);

  await expect(showRunOrder(page)).rejects.toThrow(/strict mode violation/);

  await expect(page.getByRole('status', { name: 'Activated tabs' })).toBeEmpty();
});
