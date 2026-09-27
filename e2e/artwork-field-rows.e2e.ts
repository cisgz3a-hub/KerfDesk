import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

// Side-by-side boxes stay level (a wrapped label or unit never pushes one box
// down) and share their row evenly, at every supported Artwork panel width.

interface Box {
  readonly top: number;
  readonly width: number;
}

async function boxOf(field: Locator): Promise<Box> {
  const box = await field.boundingBox();
  if (box === null) throw new Error('field is not rendered');
  return { top: box.y, width: box.width };
}

async function setPanelWidth(page: Page, panel: Locator, width: number): Promise<void> {
  await panel.evaluate((element, nextWidth) => {
    const panelElement = element as HTMLElement;
    const pixels = `${nextWidth}px`;
    panelElement.style.width = pixels;
    panelElement.style.minWidth = pixels;
    panelElement.style.maxWidth = pixels;
    panelElement.style.flex = `0 0 ${pixels}`;
  }, width);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

function expectLevel(boxes: readonly Box[]): void {
  const tops = boxes.map((box) => box.top);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
}

function expectEven(boxes: readonly Box[]): void {
  const widths = boxes.map((box) => box.width);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
}

async function addTextArtwork(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 150, y: 200 } });
  await page.getByRole('textbox', { name: 'Text content on canvas' }).fill('Even rows');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Text formatting' })).not.toBeVisible();
  return page.getByRole('complementary', { name: 'Artwork / Operations panel' });
}

test('laser settings keep Power, Speed and Passes level and even at every panel width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const panel = await addTextArtwork(page);
  await panel
    .getByRole('radiogroup', { name: /^Mode for/ })
    .getByRole('radio', { name: /^Fill/ })
    .check({ force: true });
  const essentials = [/^Power for/, /^Speed for/, /^Passes for/].map((name) =>
    panel.getByRole('spinbutton', { name }),
  );
  const hatch = [/^Hatch spacing for/, /^Hatch angle for/].map((name) =>
    panel.getByRole('spinbutton', { name }),
  );

  for (const width of [240, 300, 400]) {
    await setPanelWidth(page, panel, width);
    const essentialBoxes = await Promise.all(essentials.map(boxOf));
    expectLevel(essentialBoxes);
    // Below about 270 px Speed takes a larger share so a five-digit speed fits.
    if (width >= 280) expectEven(essentialBoxes);
    const hatchBoxes = await Promise.all(hatch.map(boxOf));
    expectLevel(hatchBoxes);
    expectEven(hatchBoxes);
    // No Process choice is cut off ("Ima…") at any width.
    const clipped = await panel
      .getByRole('radiogroup', { name: /^Mode for/ })
      .evaluate((group) =>
        [...group.querySelectorAll('span')]
          .filter((span) => span.scrollWidth > span.clientWidth + 1)
          .map((span) => span.textContent),
      );
    expect(clipped).toEqual([]);
  }
});

test('CNC feed boxes stay level and even at every panel width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'CNC', exact: true }).click();
  const panel = await addTextArtwork(page);
  const feeds = [/^Depth per pass for/, /^Feed for/, /^Plunge for/].map((name) =>
    panel.getByRole('spinbutton', { name }),
  );

  for (const width of [240, 300, 400]) {
    await setPanelWidth(page, panel, width);
    const boxes = await Promise.all(feeds.map(boxOf));
    expectEven(boxes);
    // Fields whose grid cells start on the same line share a row: their boxes
    // must be level too.
    const cellTops = await Promise.all(
      feeds.map((field) =>
        field.evaluate((input) =>
          Math.round(input.closest('.lf-cnc-setting-row')?.getBoundingClientRect().top ?? 0),
        ),
      ),
    );
    for (const top of new Set(cellTops)) {
      expectLevel(boxes.filter((_, index) => cellTops[index] === top));
    }
  }
});

test('Box Fit Test boxes stay level when a long label wraps', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page
    .getByRole('menubar', { name: 'Application menu', exact: true })
    .getByRole('menuitem', { name: 'Tools', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Box Fit Test...', exact: true }).click();
  const dialog = page.getByRole('dialog').last();
  const firstRow = ['Material thickness (mm)', 'Finger width', 'Ladder start'].map((name) =>
    dialog.getByRole('spinbutton', { name, exact: true }),
  );
  const boxes = await Promise.all(firstRow.map(boxOf));
  expectLevel(boxes);
  expectEven(boxes);
});
