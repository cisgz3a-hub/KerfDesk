// Rolling audit v7 L3-P1-3 (ADR-591 Amendment 1): text whose font has no glyph for a character
// burns the font's box or nothing there. The receipt says so, and the phone shows it.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, launch, phonePage, writes } from './remote-app-support.mjs';

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const GLYPH_NOTICE = 'Pacifico has no 李; each engraves as a box, or not at all.';

test('phone Add text shows the font warning its receipt carries', async () => {
  const state = fixture({ errors: [] });
  state.replies = {
    add_text: () => {
      state.revision += 1;
      return {
        revision: `r${state.revision}`,
        changedArtworkIds: ['text-new'],
        notices: [{ level: 'warning', message: GLYPH_NOTICE }],
      };
    },
  };
  const { page, context } = await phonePage(browser, state);
  try {
    await page
      .getByRole('navigation', { name: 'Tools' })
      .getByRole('button', { name: 'Add text' })
      .click();
    const canvas = page.locator('.canvas-wrap');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const sheet = page.getByRole('dialog');
    await sheet.getByPlaceholder('Your text').fill('Café 李');
    await sheet.getByRole('button', { name: 'Add text' }).click();
    const toast = page.locator('.toasts').getByText(GLYPH_NOTICE);
    await toast.waitFor();
    assert.equal(
      await toast.evaluate((node) => node.closest('.toast')?.className),
      'toast warning',
    );
    assert.equal(writes(state).filter((item) => item.name === 'add_text').length, 1);
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});
