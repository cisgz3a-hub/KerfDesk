import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures/kerfdesk-test';

const tokensCss = readFileSync(
  fileURLToPath(new URL('../src/ui/theme/tokens.css', import.meta.url)),
  'utf8',
);

test('keeps rail focus visible without leaking rail chrome into nested dialogs', async ({
  page,
}) => {
  await page.setContent(`
    <button id="before" type="button">Before rail</button>
    <section class="lf-pane-form">
      <input id="rail-input" class="lf-input" type="number" value="1500" />
      <select id="rail-select" class="lf-select"><option>Rail option</option></select>
      <div class="lf-dialog">
        <label class="lf-field">
          <span id="dialog-label" class="lf-field-label lf-field-label--sm">Dialog value</span>
          <input id="dialog-input" class="lf-input" type="number" value="1500" />
        </label>
        <select id="dialog-select" class="lf-select"><option>Dialog option</option></select>
        <button id="dialog-button" type="button">Dialog action</button>
        <input id="dialog-checkbox" class="lf-checkbox" type="checkbox" />
        <input id="dialog-disabled" class="lf-input" type="text" value="Disabled" disabled />
      </div>
    </section>
    <div class="lf-dialog">
      <label class="lf-field">
        <span id="baseline-label" class="lf-field-label lf-field-label--sm">Dialog value</span>
        <input id="baseline-input" class="lf-input" type="number" value="1500" />
      </label>
      <select id="baseline-select" class="lf-select"><option>Dialog option</option></select>
      <button id="baseline-button" type="button">Dialog action</button>
      <input id="baseline-checkbox" class="lf-checkbox" type="checkbox" />
      <input id="baseline-disabled" class="lf-input" type="text" value="Disabled" disabled />
    </div>
  `);
  await page.addStyleTag({ content: tokensCss });

  await page.locator('#before').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#rail-input')).toBeFocused();

  const railInputFocus = await page.locator('#rail-input').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      fontSize: style.fontSize,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      paddingTop: style.paddingTop,
    };
  });

  await page.keyboard.press('Tab');
  await expect(page.locator('#rail-select')).toBeFocused();

  const styles = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const railSelect = document.querySelector('#rail-select');
    const dialog = document.querySelector('#dialog-input');
    const dialogLabel = document.querySelector('#dialog-label');
    if (!(railSelect instanceof HTMLSelectElement)) throw new Error('rail select missing');
    if (!(dialog instanceof HTMLInputElement)) throw new Error('dialog input missing');
    if (!(dialogLabel instanceof HTMLSpanElement)) throw new Error('dialog label missing');
    const railSelectStyle = getComputedStyle(railSelect);
    const dialogStyle = getComputedStyle(dialog);
    const snapshots = Object.fromEntries(
      ['input', 'select', 'button', 'checkbox', 'disabled'].map((kind) => {
        const nested = document.querySelector(`#dialog-${kind}`);
        const baseline = document.querySelector(`#baseline-${kind}`);
        if (!(nested instanceof HTMLElement) || !(baseline instanceof HTMLElement)) {
          throw new Error(`${kind} comparison control missing`);
        }
        const snapshot = (element: HTMLElement): Record<string, string> => {
          const style = getComputedStyle(element);
          return {
            accentColor: style.accentColor,
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            color: style.color,
            fontSize: style.fontSize,
            paddingTop: style.paddingTop,
          };
        };
        return [kind, { nested: snapshot(nested), baseline: snapshot(baseline) }];
      }),
    );
    return {
      railSelect: {
        focusVisible: railSelect.matches(':focus-visible'),
        fontSize: railSelectStyle.fontSize,
        outlineStyle: railSelectStyle.outlineStyle,
        outlineWidth: railSelectStyle.outlineWidth,
        paddingTop: railSelectStyle.paddingTop,
      },
      dialog: {
        fontSize: dialogStyle.fontSize,
        labelWidth: getComputedStyle(dialogLabel).width,
        paddingTop: dialogStyle.paddingTop,
      },
      baselineLabelWidth: getComputedStyle(document.querySelector('#baseline-label') as HTMLElement)
        .width,
      snapshots,
      tokens: {
        mediumText: root.getPropertyValue('--lf-text-md').trim(),
        smallText: root.getPropertyValue('--lf-text-sm').trim(),
      },
    };
  });

  for (const rail of [railInputFocus, styles.railSelect]) {
    expect(rail.focusVisible).toBe(true);
    expect(rail.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(rail.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(rail.fontSize).toBe(styles.tokens.smallText);
    expect(rail.paddingTop).toBe('3px');
  }
  expect(styles.dialog.fontSize).toBe(styles.tokens.mediumText);
  expect(styles.dialog.paddingTop).toBe('2px');
  expect(styles.dialog.labelWidth).toBe(styles.baselineLabelWidth);
  expect(styles.dialog.labelWidth).toBe('90px');
  for (const comparison of Object.values(styles.snapshots)) {
    expect(comparison.nested).toEqual(comparison.baseline);
  }
});

test('keeps CNC job setup out of Artwork and opens it through Startup Setup', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'CNC', exact: true }).click();

  const artworkPanel = page.getByLabel('Cuts / Layers resizable panel');
  await expect(artworkPanel.locator('section[aria-label="Material and bit setup"]')).toHaveCount(0);
  await expect(artworkPanel.getByLabel('Stock origin X', { exact: true })).toHaveCount(0);
  await expect(artworkPanel.getByLabel('Stock origin Y', { exact: true })).toHaveCount(0);

  const stockReference = page.getByLabel('Stock from Startup Setup');
  await expect(stockReference).toBeVisible();
  await stockReference
    .getByRole('button', { name: 'Expand stock reference from Startup Setup' })
    .click();
  await expect(stockReference.locator('input')).toHaveCount(0);
  await stockReference.getByRole('button', { name: 'Edit in Startup Setup' }).click();
  const startup = page.getByRole('dialog', { name: 'CNC Startup Setup' });
  await expect(startup).toBeVisible();
  await expect(startup.getByLabel('Stock origin X', { exact: true })).toBeVisible();
  await expect(startup.getByLabel('Stock origin Y', { exact: true })).toBeVisible();
});

test('keeps setup-owned CNC references readable at supported Artwork widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'CNC', exact: true }).click();
  await page.getByRole('button', { name: 'Text...', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text content' }).fill('CNC width check');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const panel = page.getByLabel('Cuts / Layers resizable panel');
  const machineMaximum = panel.getByRole('button', { name: /^Machine maximum:/ });
  const artworkSpindle = panel.getByRole('spinbutton', { name: /^Artwork spindle speed for/ });
  await expect(machineMaximum).toBeVisible();
  await expect(artworkSpindle).toBeVisible();

  for (const width of [240, 300, 340]) {
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

    const panelMetrics = await panel.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        left: box.left,
        right: box.right,
        scrollWidth: element.scrollWidth,
        width: box.width,
      };
    });
    expect(Math.abs(panelMetrics.width - width)).toBeLessThanOrEqual(1);
    expect(panelMetrics.scrollWidth).toBeLessThanOrEqual(panelMetrics.clientWidth + 1);

    const maximumBox = await machineMaximum.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { bottom: box.bottom, left: box.left, right: box.right, top: box.top };
    });
    const spindleBox = await artworkSpindle.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { bottom: box.bottom, left: box.left, right: box.right, top: box.top };
    });
    for (const box of [maximumBox, spindleBox]) {
      expect(box.left).toBeGreaterThanOrEqual(panelMetrics.left - 1);
      expect(box.right).toBeLessThanOrEqual(panelMetrics.right + 1);
    }
    expect(maximumBox.bottom).toBeLessThanOrEqual(spindleBox.top + 1);
  }

  await machineMaximum.click();
  await expect(
    panel.getByText('This is the machine maximum spindle speed saved in Startup Setup.'),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Edit in Startup Setup' })).toBeVisible();
});
