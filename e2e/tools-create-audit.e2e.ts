import {
  test as fixtureTest,
  expect,
  type Page,
  type KerfDeskFixture,
} from './fixtures/kerfdesk-test';
import {
  barcodeAcceptanceSnapshot as snapshot,
  barcodeAcceptanceHistory as history,
} from './fixtures/barcode-acceptance-browser';
import { toolbarCommand } from './fixtures/workspace-ui';
import { createProject, IDENTITY_TRANSFORM } from '../src/core/scene';
import { createEllipse } from '../src/core/shapes/primitives/create-ellipse';

// Keep the already loaded dev-module graph while resetting each disposable
// document through File Open. Playwright starts a fresh worker after a failure.
let sharedPage: Page | undefined;
let projectSequence = 0;
const test = fixtureTest.extend({
  page: async ({ browser }, use) => {
    sharedPage ??= await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await use(sharedPage);
  },
});
test.setTimeout(240_000);
test.use({ actionTimeout: 30_000 });
test.afterAll(async () => {
  await sharedPage?.close();
});

test.beforeEach(async ({ page, kerfdesk }) => {
  if (page.url() === 'about:blank') {
    await page.goto(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '5173'}/`, {
      waitUntil: 'domcontentloaded',
    });
  }
  await expect(page.getByRole('menubar', { name: 'Application menu', exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const project = createProject();
  await openProject(
    page,
    kerfdesk,
    `tools-create-audit-${++projectSequence}.lf2`,
    JSON.stringify({
      ...project,
      device: { ...project.device, homing: { ...project.device.homing, enabled: true } },
    }),
  );
});

test.afterEach(async ({ page, kerfdesk }, info) => {
  await info.attach('browser-workflow', {
    body: await page.screenshot({ timeout: 10_000 }),
    contentType: 'image/png',
  });
  const events = await kerfdesk.events();
  await info.attach('fixture-events', {
    body: JSON.stringify(events),
    contentType: 'application/json',
  });
  expect(
    events.filter((event) => event.kind === 'serial-open' || event.kind === 'serial-write'),
  ).toEqual([]);
  await page.keyboard.press('Escape');
});

async function openProject(page: Page, fixture: KerfDeskFixture, name: string, text: string) {
  await fixture.setOpenFiles([{ name, text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  const discard = page.getByRole('dialog', { name: 'Save changes?', exact: true });
  await expect
    .poll(async () => (await page.title()).includes(name) || (await discard.isVisible()), {
      // The first project open also loads the document worker on a cold dev server.
      timeout: 90_000,
    })
    .toBe(true);
  if (await discard.isVisible()) {
    await discard.getByRole('button', { name: "Don't Save", exact: true }).click();
  }
  await expect(page).toHaveTitle(new RegExp(name.replaceAll('.', '\\.')), { timeout: 30_000 });
}

async function tool(page: Page, name: string) {
  const menu = page.locator('details[data-menu-family="tools"]');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  // Shortcut text participates in the accessible name (for example Measure Alt+M).
  const command = menu.locator('button').filter({ has: page.getByText(name, { exact: true }) });
  await command.click({ timeout: 15_000 });
  if (name !== 'Measure' && name !== 'Text...') {
    await page
      .locator('[role="dialog"], section[aria-label="Place board"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
  }
  await test.info().attach(`command-open-${name}`, {
    body: await page.screenshot({ timeout: 10_000 }),
    contentType: 'image/png',
  });
}
async function count(page: Page) {
  return (await snapshot(page)).project.scene.objects.length;
}
async function insertedAndUndo(page: Page, minimum = 1) {
  await expect.poll(() => count(page)).toBeGreaterThanOrEqual(minimum);
  await test.info().attach('generated-artwork-before-undo', {
    body: await page.screenshot({ timeout: 10_000 }),
    contentType: 'image/png',
  });
  await history(page, false);
  await expect.poll(() => count(page)).toBe(0);
}
async function cnc(page: Page) {
  await page
    .getByRole('group', { name: 'Machine type', exact: true })
    .getByRole('button', { name: 'CNC', exact: true })
    .click();
}

test('tools.constrained-sketch reviews 75 mm solved geometry, applies and undoes', async ({
  page,
}) => {
  await tool(page, 'Constrained sketch…');
  const dialog = page.getByRole('dialog', { name: 'Constrained 2D sketch' });
  await dialog.getByLabel('width value or expression', { exact: true }).fill('75');
  await dialog.getByRole('button', { name: 'Review solved geometry' }).click();
  await expect(dialog.getByRole('status')).toContainText('fully-constrained');
  await expect(dialog.getByRole('region', { name: 'Solved sketch preview' })).toContainText(
    '75.000 × 30.000',
  );
  await dialog.getByRole('button', { name: 'Apply reviewed sketch' }).click();
  await expect(dialog).toHaveCount(0);
  await insertedAndUndo(page);
});

test('tools.parametric-part previews changed dimensions, applies and undoes', async ({ page }) => {
  await tool(page, 'Parametric part…');
  const dialog = page.getByRole('dialog', { name: 'Create parametric part', exact: true });
  await dialog.getByLabel('Overall width (mm)', { exact: true }).fill('75');
  await dialog.getByRole('button', { name: 'Preview geometry and operations' }).click();
  await dialog.getByRole('button', { name: 'Apply reviewed part' }).click();
  await expect(dialog).toHaveCount(0);
  const object = (await snapshot(page)).project.scene.objects[0];
  expect(object?.bounds.maxX).toBeCloseTo(75, 4);
  await insertedAndUndo(page);
});

test('tools.editable-relief creates 128-square CNC relief and opens its editable components', async ({
  page,
}) => {
  await cnc(page);
  await tool(page, 'Editable relief…');
  const dialog = page.getByRole('dialog', { name: 'Create editable relief', exact: true });
  await dialog.getByLabel('Relief width (mm)', { exact: true }).fill('24');
  await dialog.getByLabel('Relief height (mm)', { exact: true }).fill('20');
  await dialog
    .getByLabel('Authoring grid size (cells per side)', { exact: true })
    .selectOption('128');
  await dialog.getByRole('button', { name: 'Create relief', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit relief components', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await snapshot(page)).project.scene.objects[0]?.kind).toBe('relief');
  await insertedAndUndo(page);
});

test('tools.measure draws a transient measurement without adding artwork', async ({ page }) => {
  await tool(page, 'Measure');
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Workspace has no visible bounds');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();
  expect(await count(page)).toBe(0);
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /^Measure\s/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
});

test('tools.tangent-circle adds a verified fourth circle to three selected circles and undoes', async ({
  page,
  kerfdesk,
}) => {
  const project = createProject();
  const objects = [
    { x: 20, y: 20, r: 1 },
    { x: 30, y: 20, r: 2 },
    { x: 24, y: 28, r: 1.5 },
  ].map((v, index) =>
    createEllipse({
      id: `audit-circle-${index}`,
      color: '#000000',
      spec: { widthMm: 2 * v.r, heightMm: 2 * v.r },
      transform: { ...IDENTITY_TRANSFORM, x: v.x - v.r, y: v.y - v.r },
    }),
  );
  await openProject(
    page,
    kerfdesk,
    'tools-three-circles.lf2',
    JSON.stringify({ ...project, scene: { ...project.scene, objects } }),
  );
  await page.getByLabel('KerfDesk workspace', { exact: true }).focus();
  await page.keyboard.press('Control+a');
  await tool(page, 'Tangent Circle...');
  const dialog = page.getByRole('dialog', { name: 'Tangent Circle', exact: true });
  await expect(dialog.getByRole('radio')).toHaveCount(8);
  await dialog.getByRole('button', { name: 'Add circle', exact: true }).click();
  await expect.poll(() => count(page)).toBe(4);
  await test.info().attach('four-tangent-circles-before-undo', {
    body: await page.screenshot({ timeout: 10_000 }),
    contentType: 'image/png',
  });
  await history(page, false);
  await expect.poll(() => count(page)).toBe(3);
});

test('tools.add-text renders text, adds artwork and undoes', async ({ page }) => {
  await tool(page, 'Text...');
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 180, y: 220 } });
  const input = page.getByRole('textbox', { name: 'Text content on canvas', exact: true });
  await input.fill('Tools audit 0123');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(input).toHaveCount(0);
  await insertedAndUndo(page);
});

test('tools.registration-jig saves an outline from the editor and undoes', async ({ page }) => {
  await tool(page, 'Registration Jig');
  const editor = page.getByRole('dialog', { name: 'Registration Jig editor', exact: true });
  await editor.getByRole('button', { name: 'Save to canvas', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Registration jig controls', exact: true }),
  ).toBeVisible();
  await insertedAndUndo(page);
});

test('tools.camera exposes source/calibration panel and closes without requesting hardware', async ({
  page,
}) => {
  await tool(page, 'Camera');
  const panel = page.getByRole('dialog', { name: 'Camera preview', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/camera/i);
  await panel.getByRole('button', { name: 'Close camera panel' }).click();
  await expect(panel).toHaveCount(0);
  expect(await count(page)).toBe(0);
});

test('tools.place-board explains disconnected capture and closes without motion', async ({
  page,
}) => {
  await tool(page, 'Place Board');
  const panel = page.getByRole('region', { name: 'Place board', exact: true });
  await expect(panel).toContainText('Connect the machine to capture a board.');
  await panel.getByRole('button', { name: 'Close board capture panel' }).click();
  await expect(panel).toHaveCount(0);
  expect(await count(page)).toBe(0);
});

test('tools.rotary-setup switches to chuck, applies and persists without test rotation', async ({
  page,
}) => {
  await tool(page, 'Rotary Setup...');
  const dialog = page.getByRole('dialog', { name: 'Rotary Setup', exact: true });
  await dialog.getByRole('button', { name: 'Chuck', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await tool(page, 'Rotary Setup...');
  await expect(dialog.getByRole('button', { name: 'Chuck', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('tools.print-and-cut opens after explicit Labs opt-in and withholds incomplete registration', async ({
  page,
}) => {
  await tool(page, 'Labs...');
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /Print and Cut/ }).check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await tool(page, 'Print and Cut...');
  dialog = page.getByRole('dialog', { name: 'Print and Cut', exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Apply registration', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await count(page)).toBe(0);
  await tool(page, 'Labs...');
  await page.getByRole('dialog').getByRole('button', { name: 'Reset all', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
});

test('tools.box-generator renders flat and assembled previews, generates panels and undoes', async ({
  page,
}) => {
  await tool(page, 'Box Generator...');
  const dialog = page.getByRole('dialog', { name: 'Box Generator', exact: true });
  await expect(dialog.getByRole('img', { name: 'Generated panel sheet preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Assembled', exact: true }).click();
  await expect(dialog.getByRole('img', { name: 'Assembled box preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await insertedAndUndo(page, 6);
});

test('tools.barcode previews payload, inserts outline and undoes', async ({ page }) => {
  await tool(page, 'Barcode...');
  const dialog = page.getByRole('dialog', { name: 'Insert Barcode', exact: true });
  await dialog.getByLabel('Barcode data', { exact: true }).fill('KERFDESK-AUDIT-0123456789');
  await expect(dialog.getByRole('img', { name: /^Barcode preview:/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await insertedAndUndo(page);
});

for (const [id, label, title, generate] of [
  ['material-test', 'Material Test...', 'Material Test', 'Generate'],
  ['interval-test', 'Interval Test...', 'Interval Test', 'Generate'],
  ['scan-offset-test', 'Scan Offset Test...', 'Scan Offset Test', 'Generate uncorrected baseline'],
] as const) {
  test(`tools.${id} generates labelled calibration geometry without executing it`, async ({
    page,
  }) => {
    await tool(page, label);
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: generate, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => count(page)).toBeGreaterThan(1);
    const scene = (await snapshot(page)).project.scene;
    expect(scene.layers.some((layer) => layer.id.includes('labels'))).toBe(true);
  });
}

test('tools.focus-test opens its relative Z generator and cancels without changing artwork', async ({
  page,
}) => {
  await tool(page, 'Focus Test...');
  const dialog = page.getByRole('dialog', { name: 'Focus Test', exact: true });
  await expect(dialog).toContainText('starting focus');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await count(page)).toBe(0);
});

test('tools.optimization-settings applies source order and preserves it on reopening', async ({
  page,
}) => {
  await tool(page, 'Cut Planner...');
  const dialog = page.getByRole('dialog', { name: 'Cut Planner', exact: true });
  await dialog.getByRole('combobox', { name: /^Travel policy/ }).selectOption('source-order');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await tool(page, 'Cut Planner...');
  await expect(dialog.getByRole('combobox', { name: /^Travel policy/ })).toHaveValue(
    'source-order',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('tools.labs persists explicit opt-in and reset without invoking machine actions', async ({
  page,
}) => {
  await tool(page, 'Labs...');
  const dialog = page.getByRole('dialog');
  const toggle = dialog.getByRole('checkbox', { name: /Print and Cut/ });
  await toggle.check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await tool(page, 'Labs...');
  await expect(toggle).toBeChecked();
  await dialog.getByRole('button', { name: 'Reset all', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
});

test('tools.box-fit-test generates a clearance coupon and undoes', async ({ page }) => {
  await tool(page, 'Box Fit Test...');
  const dialog = page.getByRole('dialog', { name: 'Box Fit Test', exact: true });
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await insertedAndUndo(page, 2);
});

test('tools.ai-assistant discloses browser connection limitation and closes without a request', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (/api\.openai\.com|\/api\/assistant\//.test(request.url())) calls.push(request.url());
  });
  await tool(page, 'AI Assistant...');
  const dialog = page.getByRole('dialog', {
    name: 'AI design and material assistant',
    exact: true,
  });
  await expect(dialog).toContainText('This connection is available in the desktop app.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect(calls).toEqual([]);
  expect(await count(page)).toBe(0);
});
