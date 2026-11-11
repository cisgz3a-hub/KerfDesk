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
  return page.getByRole('complementary', { name: 'Artwork panel' });
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

// The Dither swatches wrap onto more rows rather than overflow the rail, keep
// every thumbnail at full size, and answer the arrow keys like radios.
// Twelve dithers plus 3D Sliced (ADR-699), which comes last.
const DITHER_SWATCHES = 13;
// At least three swatches a row even at 240 px.
const MIN_SWATCHES_PER_ROW = 3;

test('Image dither swatches fit and stay keyboard-operable at every panel width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const panel = await addTextArtwork(page);
  await panel
    .getByRole('radiogroup', { name: /^Mode for/ })
    .getByRole('radio', { name: /^Image/ })
    .check({ force: true });
  const dither = panel.getByRole('radiogroup', { name: /^Dither for/ });
  await expect(dither.getByRole('radio')).toHaveCount(DITHER_SWATCHES);

  for (const width of [240, 260, 280, 300, 320, 360, 400]) {
    await setPanelWidth(page, panel, width);
    const horizontalOverflow = await panel.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
    const layout = await dither.evaluate((group) => {
      const bounds = group.getBoundingClientRect();
      const tiles = [...group.querySelectorAll('.lf-dither-swatch')].map((tile) =>
        tile.getBoundingClientRect(),
      );
      const thumbnails = [...group.querySelectorAll('svg')].map(
        (svg) => svg.getBoundingClientRect().width,
      );
      return {
        outside: tiles.filter(
          (tile) => tile.left < bounds.left - 1 || tile.right > bounds.right + 1,
        ).length,
        rows: new Set(tiles.map((tile) => Math.round(tile.top))).size,
        thumbnails,
      };
    });
    expect(layout.outside).toBe(0);
    // Three swatches a row even at 240 px keeps the picker to five rows.
    expect(layout.rows).toBeLessThanOrEqual(Math.ceil(DITHER_SWATCHES / MIN_SWATCHES_PER_ROW));
    expect(layout.thumbnails).toEqual(Array.from({ length: DITHER_SWATCHES }, () => 44));
  }

  const grayscale = dither.getByRole('radio', { name: 'Grayscale', exact: true });
  await grayscale.check({ force: true });
  await expect(panel.getByRole('spinbutton', { name: /^Minimum power for/ })).toBeVisible();
  await grayscale.focus();
  await page.keyboard.press('ArrowRight');
  // 3D Sliced burns every slice at full Power, so Min power leaves with it.
  const sliced = dither.getByRole('radio', { name: '3D Sliced', exact: true });
  await expect(sliced).toBeChecked();
  await expect(sliced).toBeFocused();
  await expect(panel.getByRole('spinbutton', { name: /^Minimum power for/ })).toHaveCount(0);
  // The last swatch wraps round to the first.
  await page.keyboard.press('ArrowRight');
  const threshold = dither.getByRole('radio', { name: 'Threshold', exact: true });
  await expect(threshold).toBeChecked();
  await expect(threshold).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(dither.getByRole('radio', { name: 'Floyd-Steinberg', exact: true })).toBeChecked();

  // Burn marks stay darker than the material in either theme, so dark mode
  // never shows what burns as light.
  for (const theme of ['light', 'dark']) {
    await page.evaluate((name) => document.documentElement.setAttribute('data-theme', name), theme);
    const colors = await dither
      .locator('svg')
      .first()
      .evaluate((svg) => {
        const style = getComputedStyle(svg);
        return { mark: style.color, material: style.backgroundColor };
      });
    expect(lightness(colors.mark)).toBeLessThan(lightness(colors.material) - 100);
  }
});

function lightness(rgb: string): number {
  const [red = 0, green = 0, blue = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

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
