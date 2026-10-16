import { createProject } from '../src/core/scene';
import { expect, test } from './fixtures/kerfdesk-test';
import {
  connectAndHome,
  dismissNotifications,
  runMenuCommand,
  serialWrites,
} from './fixtures/recovery-flow';
import { openMachineToolDropdown, toolbarCommand } from './fixtures/workspace-ui';

test('manual start-from-line refuses Focus Z before sending a program', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible({
    timeout: 90_000,
  });
  const project = createProject();
  await kerfdesk.setOpenFiles([
    {
      name: 'focus-resume.lf2',
      text: JSON.stringify({
        ...project,
        device: { ...project.device, homing: { ...project.device.homing, enabled: true } },
      }),
    },
  ]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/focus-resume\.lf2/);
  await runMenuCommand(page, 'Tools', 'Focus Test...');
  const focus = page.getByRole('dialog', { name: 'Focus Test', exact: true });
  await focus.getByLabel('Samples', { exact: true }).fill('3');
  await focus.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(focus).toBeHidden();
  // Browser fixture transport only: no physical controller is available to this test.
  await connectAndHome(page, kerfdesk);
  await kerfdesk.setSerialStatusAfterCommand(
    'G54 G92 X0 Y0\n',
    '<Idle|MPos:10.000,10.000,0.000|WCO:10.000,10.000,0.000|FS:0,0>',
  );
  await page.getByRole('button', { name: 'Set origin here', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('G54 G92 X0 Y0');
  await dismissNotifications(page);
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    alerts.push(dialog.message());
    void dialog.accept();
  });
  await openMachineToolDropdown(page, 'Console');
  await page.getByText('History & recovery', { exact: true }).click();
  await page.getByText('Start from line…', { exact: true }).click();
  await page.getByLabel('Resume from G-code line', { exact: true }).fill('1');
  const before = serialWrites(await kerfdesk.events());
  await page.getByRole('button', { name: 'Resume from line', exact: true }).click();
  await expect.poll(() => alerts.join('\n')).toContain('original starting Z focus');
  expect(alerts.some((message) => message.includes('Review resume from requested line'))).toBe(
    false,
  );
  const after = serialWrites(await kerfdesk.events()).slice(before.length);
  expect(after).not.toMatch(/resume preamble|G[0123]\s|G91|G90|M[345]\b/);
  await page.screenshot({ path: info.outputPath('focus-manual-resume-refused.png') });
  await info.attach('focus-resume-refusal', {
    body: JSON.stringify({ alerts, writesAfterAttempt: after }, null, 2),
    contentType: 'application/json',
  });
  await kerfdesk.disconnectSerial();
});
