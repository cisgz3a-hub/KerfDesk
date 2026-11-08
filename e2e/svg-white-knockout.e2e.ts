// ADR-686 and its Amendments 1-3 in the browser, through the toolbar Import,
// File > Open, the Tools menu and Save G-code: a logo's solid white is cut out
// of the black under it and never burns, see-through white still burns, and a
// logo a 1.0.29 build saved is named at open and fixed in one step.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { importComposedSvg, svgUndo } from './fixtures/composed-svg-browser';
import { clearCanvasProject } from './fixtures/mixed-canvas-project';
import { runMenuCommand } from './fixtures/recovery-flow';
import { length, programBurns, saveTopologyGcode } from './fixtures/topology-repairs';
import { toolbarCommand } from './fixtures/workspace-ui';

const DIAMOND = 'M14 20 L20 12 L26 20 L20 28 Z';
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">${body}</svg>`;
const LOGO = svg(`<circle cx="20" cy="20" r="15" fill="#000"/><path d="${DIAMOND}" fill="#fff"/>`);
// The hole the author cut by hand: what the knock-out should burn.
const CONTROL = svg(
  `<path fill="#000" fill-rule="evenodd" d="M5 20 A15 15 0 1 0 35 20 A15 15 0 1 0 5 20 Z ${DIAMOND}"/>`,
);
const SEE_THROUGH = svg(
  `<circle cx="20" cy="20" r="15" fill="#000"/><path d="${DIAMOND}" fill="#fff" fill-opacity="0.3"/>`,
);

function litLength(gcode: string): number {
  return programBurns(gcode).reduce((sum, burn) => sum + length(burn), 0);
}

async function toast(page: Page, text: string) {
  const stack = page.getByRole('region', { name: 'Notifications', exact: true });
  await expect(stack.getByText(text).first()).toBeVisible({ timeout: 30_000 });
}

test('an imported logo burns no white, and one Undo burns it again', async ({ page, kerfdesk }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await importComposedSvg(page, kerfdesk, 'logo.svg', LOGO, 1);
  await toast(page, 'logo.svg: 1 solid white shape will not burn');
  const knocked = litLength(await saveTopologyGcode(page, kerfdesk));

  await svgUndo(page, 1);
  const withWhite = litLength(await saveTopologyGcode(page, kerfdesk));
  // The diamond's area burns twice without the knock-out (the U3 burn).
  expect(withWhite - knocked).toBeGreaterThan(100);

  await clearCanvasProject(page);
  await importComposedSvg(page, kerfdesk, 'control.svg', CONTROL, 1);
  const control = litLength(await saveTopologyGcode(page, kerfdesk));
  expect(knocked).toBeGreaterThan(5000);
  expect(Math.abs(knocked - control) / control).toBeLessThan(0.005);
});

test('see-through white burns as ink, and the notice says so', async ({ page, kerfdesk }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await importComposedSvg(page, kerfdesk, 'grey.svg', SEE_THROUGH, 1);
  await toast(page, 'grey.svg: 1 white shape is see-through, shaded or masked in the file');
  const seeThrough = litLength(await saveTopologyGcode(page, kerfdesk));

  await clearCanvasProject(page);
  await importComposedSvg(page, kerfdesk, 'control.svg', CONTROL, 1);
  const control = litLength(await saveTopologyGcode(page, kerfdesk));
  expect(seeThrough - control).toBeGreaterThan(100);
});

test('a logo 1.0.29 saved is named at open, and Leave Imported White Unburned fixes its burn', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(300_000);
  await page.goto('/');
  const text = gunzipSync(
    readFileSync(
      fileURLToPath(
        new URL('../src/__fixtures__/returning-user/1.0.29-white-logos.lf2.gz', import.meta.url),
      ),
    ),
  ).toString('utf8');
  await kerfdesk.setOpenFiles([{ name: 'white-logos.lf2', text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  // The project worker parses it first; a cold worker takes a while.
  await expect(page).toHaveTitle(/white-logos\.lf2/, { timeout: 90_000 });
  await toast(page, 'This project has 5 white shapes from an SVG import that burn over');
  const saved = litLength(await saveTopologyGcode(page, kerfdesk));

  await runMenuCommand(page, 'Tools', 'Leave Imported White Unburned');
  await toast(page, '5 white shapes are left unburned');
  const fixed = litLength(await saveTopologyGcode(page, kerfdesk));
  expect(saved - fixed).toBeGreaterThan(1000);
});
