import { writeFileSync } from 'node:fs';
import type { SceneObject, TextObject } from '../src/core/scene';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { composedSvgSnapshot, exportComposedSvg } from './fixtures/composed-svg-browser';
import { toolbarCommand } from './fixtures/workspace-ui';

const names = ['Ada', 'Bo', 'Chandra'];
const expectedValues = names.map(
  (name, index) => `Badge-${name}${String(index + 10).padStart(4, '0')}`,
);

for (const mode of ['Circular', 'Point Rotation'] as const) {
  test(`${mode} variable copies preserve values, placement, history and saved output`, async ({
    page,
    kerfdesk,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    await createVariableBadge(page);
    const original = await composedSvgSnapshot(page);
    await configureArray(page, mode);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await composedSvgSnapshot(page)).toEqual(original);
    await configureArray(page, mode);
    await page.getByRole('button', { name: 'Create array', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Array', exact: true })).toBeHidden();
    await expect
      .poll(async () =>
        textObjects((await composedSvgSnapshot(page)).project.scene.objects).map(
          (object) => object.content,
        ),
      )
      .toEqual(expectedValues);
    const created = await composedSvgSnapshot(page);
    expect(created.undoCount).toBe(original.undoCount + 1);
    expect(created.project.variables).toEqual(original.project.variables);
    const copies = textObjects(created.project.scene.objects);
    expect(copies.map((object) => object.variableTemplate?.sequenceOffset)).toEqual([0, 1, 2]);
    expect(copies.every((object) => object.paths.length > 0)).toBe(true);
    expectPlacement(copies, mode);
    await page.screenshot({ path: info.outputPath('variable-copies.png') });
    await shortcut(page, 'Control+z');
    await expect
      .poll(async () => (await composedSvgSnapshot(page)).project)
      .toEqual(original.project);
    await shortcut(page, 'Control+Shift+z');
    await expect
      .poll(async () => (await composedSvgSnapshot(page)).project)
      .toEqual(created.project);

    await (await toolbarCommand(page, 'Save As...')).click();
    await expect
      .poll(
        async () =>
          Object.keys(await kerfdesk.savedFiles()).filter((name) => name.endsWith('.lf2')).length,
      )
      .toBe(1);
    const saved = Object.entries(await kerfdesk.savedFiles()).find(([name]) =>
      name.endsWith('.lf2'),
    );
    if (saved === undefined) throw new Error('Variable array project was not saved');
    writeFileSync(info.outputPath('variable-array.lf2'), saved[1]);
    await kerfdesk.setOpenFiles([{ name: 'variable-array.lf2', text: saved[1] }]);
    await (await toolbarCommand(page, 'Open...')).click();
    await expect(page).toHaveTitle(/variable-array\.lf2/);
    const reopened = await composedSvgSnapshot(page);
    expect(reopened.project.scene.objects).toEqual(created.project.scene.objects);
    expect(reopened.project.variables).toEqual(original.project.variables);
    await shortcut(page, 'Control+a');
    const exported = await exportComposedSvg(page, kerfdesk);
    const titles = await page.evaluate(
      (svg) =>
        Array.from(
          new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('title'),
          (title) => title.textContent,
        ),
      exported,
    );
    expect(titles).toEqual(expectedValues);
    writeFileSync(info.outputPath('variable-array.svg'), exported);
    expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual(
      [],
    );
  });
}

async function createVariableBadge(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 150, y: 200 } });
  await page.getByRole('textbox', { name: 'Text content on canvas' }).fill('Badge-');
  await page.getByRole('checkbox', { name: 'Variable text' }).check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import CSV...' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'badges.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`name\n${names.join('\n')}\n`),
  });
  await page.getByRole('button', { name: 'CSV: name', exact: true }).click();
  await page.getByRole('button', { name: 'Serial', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Variable serial start', exact: true }).fill('10');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Text formatting' })).toBeHidden();
  await expect
    .poll(
      async () => textObjects((await composedSvgSnapshot(page)).project.scene.objects)[0]?.content,
    )
    .toBe('Badge-{{csv:name}}{{serial:4}}');
}

async function configureArray(page: Page, mode: 'Circular' | 'Point Rotation'): Promise<void> {
  await page.getByRole('menuitem', { name: 'Arrange', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Array...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Array', exact: true });
  await dialog.getByRole('tab', { name: mode, exact: true }).click();
  await dialog.getByLabel('Advance variables per copy').check();
  if (mode === 'Circular') {
    await dialog.getByLabel('Copies', { exact: true }).fill('3');
    await dialog.getByLabel('Center X (mm)', { exact: true }).fill('200');
    await dialog.getByLabel('Center Y (mm)', { exact: true }).fill('200');
    await dialog.getByLabel('Radius (mm)', { exact: true }).fill('50');
    await dialog.getByLabel('Rotate copies around the circle').check();
  } else {
    await dialog.getByLabel('Copies (includes original)', { exact: true }).fill('3');
    await dialog.getByLabel('Total angle (deg)', { exact: true }).fill('-180');
  }
}

function expectPlacement(copies: readonly TextObject[], mode: 'Circular' | 'Point Rotation'): void {
  const first = copies[0];
  if (first === undefined) throw new Error('Array contains no text');
  const pivot = worldCenter(first);
  copies.forEach((object, index) => {
    const angle = index * (mode === 'Circular' ? 120 : -60);
    expect(object.transform.rotationDeg).toBe((angle + (mode === 'Circular' ? 90 : 360)) % 360);
    if (mode === 'Circular') {
      const center = worldCenter(object);
      expect(center.x).toBeCloseTo(200 + 50 * Math.cos((angle * Math.PI) / 180), 6);
      expect(center.y).toBeCloseTo(200 + 50 * Math.sin((angle * Math.PI) / 180), 6);
    } else {
      const dx = first.transform.x - pivot.x;
      const dy = first.transform.y - pivot.y;
      const rad = (angle * Math.PI) / 180;
      expect(object.transform.x).toBeCloseTo(pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad), 6);
      expect(object.transform.y).toBeCloseTo(pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad), 6);
    }
  });
}

function worldCenter(object: TextObject): { x: number; y: number } {
  const { bounds, transform: t } = object;
  const x = ((bounds.minX + bounds.maxX) / 2) * t.scaleX * (t.mirrorX ? -1 : 1);
  const y = ((bounds.minY + bounds.maxY) / 2) * t.scaleY * (t.mirrorY ? -1 : 1);
  const rad = (t.rotationDeg * Math.PI) / 180;
  return {
    x: t.x + x * Math.cos(rad) - y * Math.sin(rad),
    y: t.y + x * Math.sin(rad) + y * Math.cos(rad),
  };
}

function textObjects(objects: readonly SceneObject[]): TextObject[] {
  return objects.filter((object): object is TextObject => object.kind === 'text');
}

async function shortcut(page: Page, key: string): Promise<void> {
  await page.getByLabel('KerfDesk workspace', { exact: true }).focus();
  await page.keyboard.press(key);
}
