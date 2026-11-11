// ADR-357 Amendment 4: a PNG at its own size is decoded by createImageBitmap
// off the UI thread instead of by an <img> inside the canvas snapshot. That
// is allowed only because Chromium gives the same pixels both ways. A JPEG
// does not (its canvas converts YUV on the GPU), and neither does a PNG with an
// embedded colour profile on Linux Chrome, so both keep the <img>. This holds
// the claim in the real browser for every PNG kind the loader meets.

import { expect, test } from './fixtures/kerfdesk-test';

type Fixture = typeof import('./fixtures/png-decode-parity');
const fixturePath = '/e2e/fixtures/png-decode-parity.ts';

test('the loader draws every kind of PNG at its own size with the pixels an <img> gave', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const rows = await page.evaluate(async (path) => {
    const fixture = (await import(/* @vite-ignore */ path)) as Fixture;
    return fixture.pngDecodeParity();
  }, fixturePath);

  expect(rows).toHaveLength(18);
  for (const row of rows) {
    // The Display P3 file carries an iCCP profile, which keeps the <img>.
    const decodedAsBitmap = row.name !== 'display-p3.png';
    expect(row, row.name).toMatchObject({ differingBytes: 0, decodedAsBitmap });
  }
  // eXIf Orientation 6 turns the frame on both routes.
  expect(rows.find((row) => row.name === 'RGB eXIf 6.png')?.size).toEqual([203, 301]);
});
