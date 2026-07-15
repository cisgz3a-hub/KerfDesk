import { expect, test as baseTest, type Page } from '@playwright/test';
import { test as kerfDeskTest, type KerfDeskFixture } from './fixtures/kerfdesk-test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect x="5" y="5" width="30" height="20" fill="none" stroke="#ff0000"/></svg>';
const PNG_BASE64 = readFileSync(
  join(
    process.cwd(),
    'src',
    '__fixtures__',
    'perceptual',
    'assets',
    'arch-house-langebaan-source.png',
  ),
).toString('base64');

baseTest(
  'assembled workbench is keyboard navigable and canvas-first at 1024px',
  async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible();
    await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Side panel' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Cuts / Layers panel' })).toBeVisible();
    await expect(page.getByLabel('Laser controls')).toHaveCount(0);

    const file = page.getByRole('menuitem', { name: 'File' });
    await file.focus();
    await file.press('ArrowRight');
    const edit = page.getByRole('menuitem', { name: 'Edit' });
    await expect(edit).toBeFocused();
    await edit.press('ArrowRight');
    const tools = page.getByRole('menuitem', { name: 'Tools' });
    await expect(tools).toBeFocused();
    await tools.press('ArrowDown');
    await expect(page.getByRole('group', { name: 'Create & measure' })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Measure' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tools).toBeFocused();
  },
);

baseTest(
  'synthetic SVG import supports layer editing, Preview, Save, and machine switching',
  async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await installFileSystemMocks(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Import SVG...' }).click();
    await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Layers: 1 (1 output)', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    const layerMode = page.getByLabel('Mode for #ff0000');
    await layerMode.selectOption('fill');
    await expect(layerMode).toHaveValue('fill');

    const preview = page.getByRole('button', { name: 'Preview', exact: true });
    await expect(preview).toBeEnabled();
    await preview.click();
    await expect(page.getByRole('group', { name: 'Preview options' })).toBeVisible();
    await preview.click();

    // A fresh no-homing project intentionally defaults to Current Position,
    // which cannot be exported offline without live head coordinates. This
    // fixture is file-only, so deliberately choose Absolute before Save.
    await page.getByRole('tab', { name: 'Machine' }).click();
    await page.getByRole('button', { name: 'Expand Laser panel' }).click();
    const startFrom = page.getByLabel('Start from');
    await expect(startFrom).toHaveValue('current-position');
    await startFrom.selectOption('absolute');
    await page.getByRole('tab', { name: 'Cuts / Layers' }).click();

    await page.getByRole('button', { name: 'Save G-code...' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean((window as Window & { __e2eSaved?: string }).__e2eSaved)),
      )
      .toBe(true);

    await page.getByRole('button', { name: 'CNC', exact: true }).click();
    await expect(page.getByRole('button', { name: 'CNC', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('tab', { name: 'Machine' }).click();
    await expect(page.getByLabel('Router controls')).toBeVisible();
  },
);

baseTest(
  'Machine Setup saves a complete laser draft through the beginner flow',
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Machine Setup' });
    await expect(dialog).toContainText('Step 1 of 7 — Machine & controller');
    await expect(dialog.getByLabel('Controller firmware')).toHaveValue('grbl-v1.1');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('Step 2 of 7 — Connect & read');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByLabel('Device name').fill('E2E beginner laser');
    await dialog.getByLabel('Bed width (mm)').fill('510');
    await dialog.getByLabel('Bed width (mm)').blur();
    for (let step = 0; step < 4; step += 1) {
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    }

    await expect(dialog).toContainText('Software configuration is internally consistent');
    await expect(dialog).toContainText('Hardware commissioning — operator check after saving');
    await expect(dialog).not.toContainText('ready to cut');
    await dialog.getByRole('button', { name: 'Save machine setup', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const reopened = page.getByRole('dialog', { name: 'Machine Setup' });
    await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(reopened.getByLabel('Device name')).toHaveValue('E2E beginner laser');
    await expect(reopened.getByLabel('Bed width (mm)')).toHaveValue('510');
  },
);

baseTest(
  'Machine Setup switches to CNC and commits CNC-only machine parameters',
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Machine Setup' });

    await dialog.getByRole('radio', { name: /CNC only/ }).check();
    await dialog.getByLabel('Built-in CNC machine').selectOption('genmitsu-3018');
    await dialog.getByRole('button', { name: 'Load into draft', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('CNC clearance and spindle contract');
    await expect(dialog).not.toContainText('Laser output and accessories');
    await dialog.getByLabel('Safe Z').fill('9');
    await dialog.getByLabel('Safe Z').blur();
    for (let step = 0; step < 3; step += 1) {
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(dialog).toContainText(
      'Probe plate thickness, electrical contact, and plate removal',
    );
    await dialog.getByRole('button', { name: 'Save machine setup', exact: true }).click();

    await expect(page.getByLabel('Router controls')).toBeVisible();
    await expect(page.getByLabel('Safe Z')).toHaveValue('9');
    await expect(page.getByLabel('Spindle max')).toHaveValue('10000');
  },
);

baseTest('unconfigured auto-focus opens its setup section directly', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Set up auto-focus', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Machine Setup' });
  await expect(dialog).toContainText('Step 5 of 7 — Safety & calibration');
  await expect(dialog).toContainText('Auto-focus setup');
  await expect(dialog.getByLabel('Auto-focus command or macro')).toBeVisible();
});

baseTest('Machine Setup stays navigable at the narrow breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Machine' }).click();
  await page.getByRole('button', { name: 'Expand Laser panel' }).click();
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Machine Setup' });
  await expect(dialog).toContainText('Step 1 of 7 — Machine & controller');
  await expect(dialog.getByRole('navigation', { name: 'Machine Setup steps' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  const responsiveLayout = await dialog.locator('.lf-machine-setup-layout').evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns,
    width: element.getBoundingClientRect().width,
  }));
  expect(responsiveLayout.columns.split(' ')).toHaveLength(1);
  expect(responsiveLayout.width).toBeGreaterThan(500);

  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog).toContainText('Step 2 of 7 — Connect & read');
});

kerfDeskTest(
  'Machine Setup reads first, queues safely, then writes and verifies after Save',
  async ({ page, kerfdesk }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Machine Setup' });
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: /^Connect/ }).click();
    await expect(dialog).toContainText('Controller connected.');

    await kerfdesk.setSerialSetting(130, '350');
    const beforeRead = serialWrites(await kerfdesk.events()).length;
    await dialog.getByRole('button', { name: 'Run read-only checks', exact: true }).click();
    await expect
      .poll(async () => serialWrites(await kerfdesk.events()).slice(beforeRead))
      .toContain('$I\n');
    await expect
      .poll(async () => serialWrites(await kerfdesk.events()).slice(beforeRead))
      .toContain('$$\n');
    expect(serialWrites(await kerfdesk.events()).slice(beforeRead)).not.toMatch(/\$\d+=/);

    await dialog.getByRole('button', { name: 'Use detected values', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText(
      'Detected values applied to this setup draft',
    );

    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByLabel('GRBL $30 max power S').fill('900');
    await dialog.getByLabel('GRBL $30 max power S').blur();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('Queue $30 for Save');

    await dialog.getByRole('button', { name: 'Export backup', exact: true }).click();
    await expect
      .poll(async () => Object.keys(await kerfdesk.savedFiles()).length)
      .toBeGreaterThan(0);
    await dialog.getByLabel('Confirm controller backup exported').check();
    await dialog.getByLabel('Confirm write $30').check();
    const beforeQueue = serialWrites(await kerfdesk.events()).length;
    await dialog.getByRole('button', { name: 'Queue $30 for Save', exact: true }).click();
    await expect(dialog).toContainText('Remove queued $30');
    expect(serialWrites(await kerfdesk.events()).slice(beforeQueue)).not.toContain('$30=900');

    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('$30=900; exact re-read required');
    const beforeSave = serialWrites(await kerfdesk.events()).length;
    await dialog
      .getByRole('button', { name: 'Save setup and write 1 setting', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => serialWrites(await kerfdesk.events()).slice(beforeSave))
      .toContain('$30=900\n');
    expect(serialWrites(await kerfdesk.events()).slice(beforeSave)).toContain('$$\n');

    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const reopened = page.getByRole('dialog', { name: 'Machine Setup' });
    for (let step = 0; step < 3; step += 1) {
      await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(reopened.getByLabel('GRBL $30 max power S')).toHaveValue('900');
  },
);

baseTest('synthetic bitmap reaches Trace preview and commits a traced object', async ({ page }) => {
  await installFileSystemMocks(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Image...' }).click();
  const trace = page.getByRole('button', { name: 'Trace Image...' });
  await expect(trace).toBeEnabled();
  await trace.click();
  await expect(page.getByRole('dialog', { name: 'Trace image' })).toBeVisible();
  await expect(page.getByLabel('Trace preset')).toHaveValue('Line Art');
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Trace image' })).toHaveCount(0);
  await expect(page.getByText('Objects: 2', { exact: true })).toBeVisible();
});

kerfDeskTest(
  'controller positions, not acknowledgements, drive the live canvas trail',
  async ({ page, kerfdesk }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open...' }).click();
    const probe = page.getByTestId('canvas-motion-probe');
    await expect(probe).toHaveAttribute('aria-label', /Frame start ready; Job start ready/);
    await connectAndHome(page, kerfdesk);
    await kerfdesk.setAutoAcknowledge(false);
    page.on('dialog', (dialog) => void dialog.accept());
    const baselineLines = serialWriteLineCount(await kerfdesk.events());
    const writesBefore = serialWrites(await kerfdesk.events()).length;
    await page.getByRole('button', { name: 'Start job' }).click();
    await expect(probe).toHaveAttribute('data-lifecycle', 'running');
    const pixelsBeforeStatus = await canvasPixels(page);
    const initial = Number(await probe.getAttribute('data-confirmed-route-mm'));

    const program = serialWrites(await kerfdesk.events()).slice(writesBefore);
    const firstMove = /G0 X(-?\d+(?:\.\d+)?) Y(-?\d+(?:\.\d+)?)/.exec(program);
    expect(firstMove).not.toBeNull();
    const acceptedThroughFirstMove =
      [...program.slice(0, firstMove?.index ?? 0)].filter((character) => character === '\n')
        .length + 1;
    await kerfdesk.acknowledgeSerial(acceptedThroughFirstMove);
    await expect
      .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
      .toBe(initial);

    const x = Number(firstMove?.[1] ?? 0);
    const y = Number(firstMove?.[2] ?? 0);
    await kerfdesk.emitSerialLine(
      `<Run|MPos:${(x / 2).toFixed(3)},${(y / 2).toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:1500,0>`,
    );
    await expect
      .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
      .toBeGreaterThan(initial);
    const pixelsAfterStatus = await canvasPixels(page);
    expect(pixelsAfterStatus.motion).not.toBe(pixelsBeforeStatus.motion);
    expect(pixelsAfterStatus.design).toBe(pixelsBeforeStatus.design);

    const trustedHeadX = await probe.getAttribute('data-reported-head-x');
    const trustedHeadY = await probe.getAttribute('data-reported-head-y');
    expect(trustedHeadX).not.toBeNull();
    expect(trustedHeadY).not.toBeNull();
    await kerfdesk.emitSerialLine(
      '<Run|MPos:999.000,999.000,0.000|WCO:0.000,0.000,0.000|FS:1500,0>',
    );
    await expect(page.getByTestId('canvas-motion-status')).toContainText('Route match uncertain');
    await expect(probe).toHaveAttribute('data-reported-head-x', trustedHeadX ?? '');
    await expect(probe).toHaveAttribute('data-reported-head-y', trustedHeadY ?? '');
    expect((await canvasPixels(page)).motion).toBe(pixelsAfterStatus.motion);

    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    const atPause = Number(await probe.getAttribute('data-confirmed-route-mm'));
    await kerfdesk.emitSerialLine(
      `<Hold:0|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:0,0>`,
    );
    await expect(probe).toHaveAttribute('data-lifecycle', 'paused');
    expect(Number(await probe.getAttribute('data-confirmed-route-mm'))).toBe(atPause);
    await page.getByRole('button', { name: 'Resume', exact: true }).first().click();
    await kerfdesk.emitSerialLine(
      `<Run|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:1500,0>`,
    );
    await expect
      .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
      .toBeGreaterThan(atPause);

    await drainHeldSerialWrites(page, kerfdesk, baselineLines, acceptedThroughFirstMove);
    await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
    await expect(probe).toHaveAttribute('data-lifecycle', 'finished');
    expect(Number(await probe.getAttribute('data-confirmed-route-mm'))).toBeGreaterThan(atPause);
  },
);

baseTest('an interrupted-job checkpoint surfaces recovery before normal work', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'laserforge.job-checkpoint.v1',
      JSON.stringify({
        schemaVersion: 3,
        fingerprint: { fnv1a: 1, chars: 8, lines: 3 },
        sendableLines: 2,
        ackedLines: 1,
        resumeInFlight: false,
        machineKind: 'laser',
        outputScope: {
          cutSelectedGraphics: false,
          useSelectionOrigin: false,
          selectedObjectIds: [],
        },
        startedAtIso: '2026-07-11T12:00:00.000Z',
        updatedAtIso: '2026-07-11T12:00:01.000Z',
      }),
    );
  });
  await page.goto('/');
  await expect(page.getByText('Interrupted laser job', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review safe recovery' })).toBeVisible();
});

async function installFileSystemMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ svg, pngBase64 }) => {
      const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
      interface PickerOptions {
        readonly types?: readonly { readonly accept?: Record<string, string[]> }[];
      }
      const fileWindow = window as unknown as Window & {
        showOpenFilePicker: (options?: PickerOptions) => Promise<readonly FileSystemFileHandle[]>;
        showSaveFilePicker: () => Promise<FileSystemFileHandle>;
      };
      fileWindow.showOpenFilePicker = async (options) => {
        const extensions =
          options?.types?.flatMap((type) => Object.values(type.accept ?? {}).flat()) ?? [];
        const image = extensions.includes('.png');
        const file = image
          ? new File([bytes], 'trace-source.png', { type: 'image/png' })
          : new File([svg], 'fixture.svg', { type: 'image/svg+xml' });
        return [
          { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle,
        ];
      };
      fileWindow.showSaveFilePicker = async () =>
        ({
          kind: 'file',
          name: 'synthetic.gcode',
          getFile: async () => new File([], 'synthetic.gcode'),
          createWritable: async () => ({
            write: async (data: string | Blob | BufferSource) => {
              (window as Window & { __e2eSaved?: string }).__e2eSaved =
                typeof data === 'string' ? data : 'binary';
            },
            close: async () => undefined,
            abort: async () => undefined,
          }),
        }) as FileSystemFileHandle;
    },
    { svg: SVG, pngBase64: PNG_BASE64 },
  );
}

async function connectAndHome(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Machine settings detected:/)).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('G4 P0.01');
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
}

interface CanvasPixels {
  readonly design: string;
  readonly motion: string;
}

async function canvasPixels(page: Page): Promise<CanvasPixels> {
  const design = page.locator('canvas[aria-label*="workspace"]');
  const motion = page.getByTestId('canvas-motion-layer');
  await expect(design).toHaveCount(1);
  await expect(motion).toHaveCount(1);
  return {
    design: await design.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    motion: await motion.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
  };
}

function serialWrites(events: readonly Readonly<Record<string, unknown>>[]): string {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .join('');
}

function serialWriteLineCount(events: readonly Readonly<Record<string, unknown>>[]): number {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .reduce((count, text) => count + [...text].filter((character) => character === '\n').length, 0);
}

async function drainHeldSerialWrites(
  page: Page,
  kerfdesk: KerfDeskFixture,
  baselineLines: number,
  alreadyAcknowledged: number,
): Promise<void> {
  let acknowledged = alreadyAcknowledged;
  let stablePasses = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const written = serialWriteLineCount(await kerfdesk.events()) - baselineLines;
    const pending = written - acknowledged;
    if (pending > 0) {
      await kerfdesk.acknowledgeSerial(pending);
      acknowledged += pending;
      stablePasses = 0;
    } else {
      stablePasses += 1;
      if (stablePasses >= 3) return;
    }
    await page.waitForTimeout(25);
  }
  throw new Error('Held serial writes did not drain.');
}
