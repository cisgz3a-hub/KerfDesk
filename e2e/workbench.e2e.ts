import { expect, test, type Page } from '@playwright/test';
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

test('assembled workbench is keyboard navigable and canvas-first at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible();
  await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Side panel' })).toBeVisible();
  await expect(page.getByLabel('Cuts / Layers panel')).toBeVisible();
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
  await expect(page.getByRole('menuitem', { name: 'Measure' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(tools).toBeFocused();
});

test('synthetic SVG import supports layer editing, Preview, Save, and machine switching', async ({
  page,
}) => {
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
});

test('synthetic bitmap reaches Trace preview and commits a traced object', async ({ page }) => {
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

test('an interrupted-job checkpoint surfaces recovery before normal work', async ({ page }) => {
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
