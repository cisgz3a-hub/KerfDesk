// Rolling audit v5 J3-P2-3 (ADR-125 Amendment 3): the phone Import sheet shows what the PC's
// import receipt reports, the bed fit and every notice, instead of a plain "Imported.". A fit
// makes the burn smaller than the file, so it must be kept or restored before the sheet closes.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, launch, phonePage, refusal, writes } from './remote-app-support.mjs';

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const FIT = {
  scale: 0.36,
  fileWidthMm: 1000,
  fileHeightMm: 500,
  bedWidthMm: 400,
  bedHeightMm: 400,
};
const FIT_NOTICE =
  'big.svg is larger than the 400 × 400 mm bed (1000 × 500 mm), so it was scaled to 36% to fit. Undo restores the original size.';
const SUCCESS = 'Imported big.svg (3 paths).';
const fitted = {
  notices: [
    { level: 'success', message: SUCCESS },
    { level: 'warning', message: FIT_NOTICE },
  ],
  bedFit: FIT,
};

/** The PC's import receipt at the next revision; `state.importRevision` keeps that revision. */
function importReply(state, fields) {
  return () => {
    state.revision += 1;
    state.importRevision = `r${state.revision}`;
    return {
      revision: state.importRevision,
      changedArtworkIds: ['a2'],
      history: { canUndo: true, canRedo: false },
      ...fields,
    };
  };
}

async function importFile(page, name) {
  const open = page.getByRole('button', { name: 'Import a file' });
  await open.waitFor();
  await open.click();
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H10"/></svg>'),
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
}

const review = (page) => page.getByRole('dialog', { name: 'Check this import' });

test('phone import: a bed fit is shown first and closes only through Keep or Restore', async () => {
  const state = fixture({ errors: [] });
  state.replies = { import_file: importReply(state, fitted) };
  const { page, context } = await phonePage(browser, state);
  try {
    await importFile(page, 'big.svg');
    const dialog = review(page);
    await dialog.getByText('Scaled to 36% to fit the bed').waitFor();
    assert.equal(await dialog.getByText('File 1000 × 500 mm, bed 400 × 400 mm.').isVisible(), true);
    // The fit, then the PC's warnings, then its success line.
    const banners = await dialog.locator('.banner').allInnerTexts();
    assert.deepEqual(banners.slice(1), [FIT_NOTICE, SUCCESS]);
    assert.equal(await dialog.getByRole('button', { name: 'Close' }).count(), 0);
    await page.keyboard.press('Escape');
    await page.mouse.click(8, 8);
    assert.equal(await dialog.isVisible(), true);
    await dialog.getByRole('button', { name: 'Keep at 36%' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(
      writes(state).some((item) => item.name === 'undo'),
      false,
    );
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});

test('phone import: Restore file size undoes the fit against the import’s own revision', async () => {
  const state = fixture({ errors: [] });
  state.replies = { import_file: importReply(state, fitted) };
  const { page, context } = await phonePage(browser, state);
  try {
    await importFile(page, 'big.svg');
    const dialog = review(page);
    await dialog.getByRole('button', { name: 'Restore file size' }).click();
    await page
      .locator('.toasts')
      .getByText('Back at the file size, 1000 × 500 mm: larger than the 400 × 400 mm bed.')
      .waitFor();
    await dialog.waitFor({ state: 'detached' });
    const undo = writes(state).filter((item) => item.name === 'undo');
    assert.equal(undo.length, 1);
    assert.equal(undo[0].args.expectedRevision, state.importRevision);
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});

test('phone import: a refused Restore keeps the sheet open and says the fit may remain', async () => {
  const state = fixture({ errors: [] });
  state.replies = {
    import_file: importReply(state, fitted),
    undo: () => refusal('stale_revision'),
  };
  const { page, context } = await phonePage(browser, state);
  try {
    await importFile(page, 'big.svg');
    const dialog = review(page);
    const restore = dialog.getByRole('button', { name: 'Restore file size' });
    await restore.click();
    await dialog.getByText('The fit may not have been undone.', { exact: false }).waitFor();
    assert.equal(await restore.isDisabled(), true);
    await dialog.getByRole('button', { name: 'Keep at 36%' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});

test('phone import: an assumed unit without a fit is listed, and the sheet closes as usual', async () => {
  const state = fixture({ errors: [] });
  const units = 'units.dxf: Unrecognized $INSUNITS 22 — assuming millimeters.';
  state.replies = {
    import_file: importReply(state, {
      notices: [
        { level: 'success', message: 'Imported units.dxf (1 path).' },
        { level: 'warning', message: units },
      ],
    }),
  };
  const { page, context } = await phonePage(browser, state);
  try {
    await importFile(page, 'units.dxf');
    const dialog = review(page);
    await dialog.getByText(units).waitFor();
    assert.equal(await dialog.getByText('to fit the bed', { exact: false }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: 'Close' }).count(), 1);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});

test('phone import: a clean import toasts the PC’s success line, or "Imported." from an older PC', async () => {
  const state = fixture({ errors: [] });
  state.replies = {
    import_file: importReply(state, {
      notices: [{ level: 'success', message: 'Imported small.svg (1 path).' }],
    }),
  };
  const { page, context } = await phonePage(browser, state);
  try {
    await importFile(page, 'small.svg');
    await page.locator('.toasts').getByText('Imported small.svg (1 path).').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    state.replies.import_file = importReply(state, {});
    await importFile(page, 'small.svg');
    await page.locator('.toasts').getByText('Imported.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});
