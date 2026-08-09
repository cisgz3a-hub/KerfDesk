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

test('keeps paired CNC values readable inside the supported rail widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'CNC', exact: true }).click();

  const panel = page.getByLabel('Cuts / Layers resizable panel');
  const pairedInputs = page.locator('input[aria-label="Park X"], input[aria-label="Park Y"]');
  await expect(pairedInputs).toHaveCount(2);
  for (const label of ['Park X', 'Park Y']) {
    const input = page.getByLabel(label, { exact: true });
    await input.fill('-1500');
    await input.blur();
    await expect(input).toHaveValue('-1500');
  }

  for (const width of [240, 300]) {
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
      const panelElement = element as HTMLElement;
      const box = panelElement.getBoundingClientRect();
      return {
        clientWidth: panelElement.clientWidth,
        left: box.left,
        right: box.right,
        scrollWidth: panelElement.scrollWidth,
        width: box.width,
      };
    });
    expect(Math.abs(panelMetrics.width - width)).toBeLessThanOrEqual(1);
    expect(panelMetrics.scrollWidth).toBeLessThanOrEqual(panelMetrics.clientWidth);

    const metrics = await pairedInputs.evaluateAll((inputs) =>
      inputs.map((input) => {
        if (!(input instanceof HTMLInputElement)) throw new Error('paired number input missing');
        const group = input.parentElement;
        const column = group?.parentElement;
        const prefix = group?.firstElementChild;
        const card = input.closest('section[aria-label="Material and bit setup"]');
        if (!(group instanceof HTMLSpanElement)) throw new Error('pair group missing');
        if (!(column instanceof HTMLDivElement)) throw new Error('pair value column missing');
        if (!(prefix instanceof HTMLSpanElement)) throw new Error('pair prefix missing');
        if (!(card instanceof HTMLElement)) throw new Error('material and bit card missing');
        const inputBox = input.getBoundingClientRect();
        const groupBox = group.getBoundingClientRect();
        const columnBox = column.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        return {
          cardLeft: cardBox.left,
          cardRight: cardBox.right,
          clientWidth: input.clientWidth,
          scrollWidth: input.scrollWidth,
          inputLeft: inputBox.left,
          inputRight: inputBox.right,
          inputWidth: inputBox.width,
          groupLeft: groupBox.left,
          groupRight: groupBox.right,
          columnLeft: columnBox.left,
          columnRight: columnBox.right,
          prefix: prefix.textContent,
        };
      }),
    );

    expect(metrics.map((metric) => metric.prefix)).toEqual(['X', 'Y']);
    for (const metric of metrics) {
      expect(metric.inputWidth).toBeGreaterThanOrEqual(64);
      expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth);
      expect(metric.groupLeft).toBeGreaterThanOrEqual(metric.columnLeft - 0.5);
      expect(metric.groupRight).toBeLessThanOrEqual(metric.columnRight + 0.5);
      expect(metric.inputLeft).toBeGreaterThanOrEqual(metric.columnLeft - 0.5);
      expect(metric.inputRight).toBeLessThanOrEqual(metric.columnRight + 0.5);
      expect(metric.groupLeft).toBeGreaterThanOrEqual(metric.cardLeft - 0.5);
      expect(metric.groupRight).toBeLessThanOrEqual(metric.cardRight + 0.5);
      expect(metric.inputLeft).toBeGreaterThanOrEqual(panelMetrics.left - 0.5);
      expect(metric.inputRight).toBeLessThanOrEqual(panelMetrics.right + 0.5);
    }
  }
});
