import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Project } from '../src/core/scene';
import { expect, test } from './fixtures/kerfdesk-test';
import { selectWorkspacePanel, toolbarCommand } from './fixtures/workspace-ui';

// A local reproduction can use the exact original PNG without committing it.
const imagePath =
  process.env['SHARP_TRACE_IMAGE'] ??
  fileURLToPath(
    new URL(
      '../src/__fixtures__/perceptual/assets/centerline-stress-test-20260909.png',
      import.meta.url,
    ),
  );

// Retaining repeated DOM snapshots of a half-million-vertex SVG can itself
// dominate the renderer's memory. Keep stage evidence and final screenshots.
test.use({ trace: 'off', viewport: { width: 1440, height: 1000 } });

test('dense Sharp artwork traces, previews and completes one simulated Frame', async ({
  page,
}, testInfo) => {
  test.setTimeout(420_000);
  const bytes = readFileSync(imagePath);
  const stages: unknown[] = [];
  const record = (stage: string, details: unknown = {}) => {
    stages.push({ stage, at: new Date().toISOString(), details });
    writeFileSync(
      testInfo.outputPath('sharp-output-evidence.json'),
      JSON.stringify(
        {
          image: basename(imagePath),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          stages,
        },
        null,
        2,
      ),
    );
  };
  let crashes = 0;
  const errors: string[] = [];
  page.on('crash', () => {
    crashes += 1;
    record('renderer-crash');
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
    record('page-error', error.message);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await page.evaluate(
    ({ base64, name }) => {
      const image = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([image], name, { type: 'image/png' });
      Object.assign(window, {
        showOpenFilePicker: async () => [{ kind: 'file', name, getFile: async () => file }],
      });
    },
    { base64: bytes.toString('base64'), name: basename(imagePath) },
  );
  await (await toolbarCommand(page, 'Import...')).click();
  const traceButton = page.getByRole('button', { name: 'Trace Image...', exact: true });
  await expect(traceButton).toBeEnabled({ timeout: 30_000 });
  record('imported');
  await traceButton.click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Sharp');
  await expect(dialog.locator('[aria-label^="Trace preview ("] svg path').first()).toBeVisible({
    timeout: 180_000,
  });
  await expect(dialog.getByText(/Preview failed:/)).toHaveCount(0);
  record('sharp-preview-ready');
  await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  const trace = await page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ path)) as {
      useStore: { getState: () => { project: Project } };
    };
    const object = useStore
      .getState()
      .project.scene.objects.find((item) => item.kind === 'traced-image');
    if (object?.kind !== 'traced-image') throw new Error('Sharp trace was not committed');
    return {
      contours: object.paths.reduce((total, path) => total + path.polylines.length, 0),
      vertices: object.paths.reduce(
        (total, path) => total + path.polylines.reduce((n, line) => n + line.points.length, 0),
        0,
      ),
      width: object.tracePixelWidth,
      height: object.tracePixelHeight,
    };
  });
  expect(trace.vertices).toBeGreaterThan(100_000);
  record('committed', trace);

  await (await toolbarCommand(page, 'Preview')).click();
  const play = page.getByRole('button', { name: 'Play route preview', exact: true });
  await expect(play).toBeEnabled({ timeout: 180_000 });
  record('preview-ready');
  await page.getByRole('slider', { name: 'Preview toolpath scrubber' }).fill('0.5');
  await play.click();
  const pause = page.getByRole('button', { name: 'Pause route preview', exact: true });
  await expect(pause).toBeEnabled();
  await pause.click();
  await page.screenshot({ path: testInfo.outputPath('sharp-preview.png') });
  record('scrub-and-playback-work');

  // The fixture supplies a simulated serial controller; no hardware is used.
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible({ timeout: 15_000 });
  const frame = page.getByRole('button', { name: 'Frame job', exact: true });
  await expect(frame).toBeEnabled();
  await frame.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('Expected the Frame button');
    button.click();
    button.click();
    button.click();
  });
  await expect(page.getByRole('button', { name: 'Preparing Frame…', exact: true })).toBeDisabled();
  record('frame-preparing');
  await expect(
    page.getByText('Ready to start — framed job unchanged', { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  record('simulated-frame-complete');
  await expect(page.getByText(/Background output preparation queue is full/)).toHaveCount(0);
  await expect(page.getByText(/job or machine setup changed during preparation/)).toHaveCount(0);
  expect(crashes).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('sharp-frame-complete.png') });
});
