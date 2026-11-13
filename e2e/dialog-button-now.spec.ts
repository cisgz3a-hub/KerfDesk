import { clickDialogButtonIfReady } from './fixtures/dialog-button-now';
import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

/**
 * The save fixtures poll a dialog that may close at any moment. Three specs on
 * main (topology-repairs, trace-presets-stress-worker, photo-test-card) timed
 * out at 90 s the same way: the button was visible, the dialog closed, and the
 * next check waited for a button that never came back.
 */

async function showSaveDialog(page: Page): Promise<Locator> {
  await page.setContent(`
    <div id="dialog" role="dialog" aria-label="Save project">
      <button type="button" onclick="window.clicks = (window.clicks ?? 0) + 1">Choose file…</button>
    </div>
  `);
  return page.getByRole('dialog', { name: 'Save project' }).getByRole('button', {
    name: 'Choose file…',
  });
}

/** The button, with its dialog closing as soon as a visibility check has answered. */
function closingAfterVisibleCheck(page: Page, button: Locator): Locator {
  return new Proxy(button, {
    get(target, property) {
      if (property === 'isVisible') {
        return async (...args: Parameters<Locator['isVisible']>) => {
          const visible = await target.isVisible(...args);
          // As when the picker opens by itself, or the file is written.
          await page.evaluate(() => document.getElementById('dialog')?.remove());
          return visible;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const clicks = (page: Page) =>
  page.evaluate(() => (window as typeof window & { clicks?: number }).clicks ?? 0);

test('a dialog that closes between the visible and enabled checks does not stall the poll', async ({
  page,
}) => {
  const choose = await showSaveDialog(page);
  await expect(choose).toBeVisible();
  const started = Date.now();
  await clickDialogButtonIfReady(closingAfterVisibleCheck(page, choose));
  // Bounded by the 1 s enabled check, not by the test timeout.
  expect(Date.now() - started).toBeLessThan(5_000);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await clicks(page)).toBe(0);
});

test('a ready dialog button is clicked once', async ({ page }) => {
  const choose = await showSaveDialog(page);
  await clickDialogButtonIfReady(choose);
  expect(await clicks(page)).toBe(1);
});

test('a dialog that is not there is left alone at once', async ({ page }) => {
  await page.setContent('<p>No dialog</p>');
  const started = Date.now();
  await clickDialogButtonIfReady(page.getByRole('button', { name: 'Choose file…' }));
  expect(Date.now() - started).toBeLessThan(1_000);
});
