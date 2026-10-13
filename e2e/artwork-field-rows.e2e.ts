import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

// Laser essentials stack full-width sliders beside exact numeric entries.
// Paired Fill fields, CNC rows and Box Fit Test boxes stay level and even
// when labels wrap, at every supported Artwork panel width.

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

test('laser settings keep stacked sliders and exact entries aligned at every panel width', async ({
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
  const sliders = [/^Power slider for/, /^Speed slider for/].map((name) =>
    panel.getByRole('slider', { name }),
  );
  const hatch = [/^Hatch spacing for/, /^Hatch angle for/].map((name) =>
    panel.getByRole('spinbutton', { name }),
  );

  for (const width of [240, 260, 280, 300, 320, 360, 400]) {
    await setPanelWidth(page, panel, width);
    const essentialBoxes = await Promise.all(
      essentials.map(async (field) => {
        const box = await field.boundingBox();
        if (box === null) throw new Error('essential field is not rendered');
        return {
          top: box.y,
          bottom: box.y + box.height,
          width: box.width,
          right: box.x + box.width,
        };
      }),
    );
    expectEven(essentialBoxes);
    const rightEdges = essentialBoxes.map((box) => box.right);
    expect(Math.max(...rightEdges) - Math.min(...rightEdges)).toBeLessThanOrEqual(1);
    essentialBoxes.forEach((box, index) => {
      const previous = essentialBoxes[index - 1];
      if (previous !== undefined) expect(box.top).toBeGreaterThan(previous.bottom);
    });
    for (const slider of sliders) {
      const bounds = await slider.evaluate((element) => {
        const essentialsGrid = element.closest('.lf-laser-essentials__grid');
        if (essentialsGrid === null) throw new Error('slider essentials grid is not rendered');
        const track = element.getBoundingClientRect();
        const grid = essentialsGrid.getBoundingClientRect();
        return { leftGap: track.left - grid.left, rightGap: grid.right - track.right };
      });
      expect(Math.abs(bounds.leftGap)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds.rightGap)).toBeLessThanOrEqual(1);
    }
    const horizontalOverflow = await panel.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
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

// ADR-431: Cut depth and Depth per pass share one row, Feed, Plunge and
// Spindle speed the next. Each row's boxes stay level and even at every width;
// at the narrowest width Spindle speed wraps under Feed.
test('CNC depth and feed boxes stay level and even at every panel width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'CNC', exact: true }).click();
  const panel = await addTextArtwork(page);
  const rows = [
    [/^Cut depth for/, /^Depth per pass for/],
    [/^Feed for/, /^Plunge for/, /^Spindle speed for/],
  ].map((names) => names.map((name) => panel.getByRole('spinbutton', { name })));

  for (const width of [240, 300, 400]) {
    await setPanelWidth(page, panel, width);
    // Below about 290 px Spindle speed takes its own row so five digits fit.
    const [depthRow = [], feedRow = []] = rows;
    const levelRows = width >= 290 ? [depthRow, feedRow] : [depthRow, feedRow.slice(0, 2)];
    for (const row of levelRows) {
      const boxes = await Promise.all(row.map(boxOf));
      expectLevel(boxes);
      expectEven(boxes);
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
