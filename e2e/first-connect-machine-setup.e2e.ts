import {
  test,
  expect,
  type KerfDeskFixture,
  type Locator,
  type Page,
} from './fixtures/kerfdesk-test';
import { applicationHeader } from './fixtures/workspace-ui';
import type { AppState } from '../src/ui/state';
import type { DeviceProfile } from '../src/core/devices';
import type { PlatformAdapter } from '../src/platform/types';

const CONFIGURED_KEY = 'laserforge.device-setup.configured.v1';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0);
});

test('first explicit Connect opens Machine setup, connects, and saved catalog setup survives reconnect and reload', async ({
  page,
  kerfdesk,
}, testInfo) => {
  // Three connection attempts and a full renderer reload share this budget.
  test.setTimeout(120_000);
  const toolbar = machineToolbar(page);
  const setup = machineSetup(page);
  await expect(setup).toHaveCount(0);
  expect(await configuredSignatures(page)).toEqual([]);

  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(setup).toBeVisible({ timeout: 3000 });
  await expect(setup).toContainText('Step 1 of 3');
  await expect(setup.getByRole('group', { name: 'Machine', exact: true })).toBeVisible();
  await expectConnected(toolbar);
  await expectConnectReadsOnly(kerfdesk);
  await page.screenshot({ path: testInfo.outputPath('first-connect-machine-setup.png') });

  await setup.getByRole('searchbox', { name: 'Search machine profiles' }).fill('Falcon A1 Pro');
  const profile = setup.getByRole('radio', {
    name: 'Use Creality Falcon A1 Pro (vendor command set)',
    exact: true,
  });
  await profile.check();
  await expect(profile).toBeChecked();
  await saveSetup(setup);
  const details = toolbar.getByRole('button', { name: /^Machine details:/ });
  await expect(details).toHaveAccessibleName(/Creality Falcon A1 Pro/);
  await expect(details).toHaveAccessibleDescription('Connected');
  const saved = await configuredSignatures(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toContain('358x268');

  await toolbar.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expectConnected(toolbar);
  await expect(setup).toHaveCount(0);
  expect(await configuredSignatures(page)).toEqual(saved);

  await page.reload();
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: /^Machine details:/ })).toHaveAccessibleName(
    /Creality Falcon A1 Pro/,
  );
  expect(await configuredSignatures(page)).toEqual(saved);
  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expectConnected(toolbar);
  await expect(setup).toHaveCount(0);
  await expectConnectReadsOnly(kerfdesk, 1, false);
});

test('cancelled unsaved setup leaves the profile unconfigured and asks again on the next explicit Connect', async ({
  page,
  kerfdesk,
}) => {
  const toolbar = machineToolbar(page);
  const setup = machineSetup(page);
  const originalName = await currentDeviceName(page);
  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(setup).toBeVisible();
  await expectConnected(toolbar);
  await setup.getByRole('button', { name: 'Check essentials', exact: true }).click();
  await setup
    .getByRole('textbox', { name: 'Device name', exact: true })
    .fill('Unsaved setup draft');
  await setup.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await expect(setup).toHaveCount(0);
  expect(await currentDeviceName(page)).toBe(originalName);
  expect(await configuredSignatures(page)).toEqual([]);

  await toolbar.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('Step 1 of 3');
  await expectConnected(toolbar);
  expect(await configuredSignatures(page)).toEqual([]);
  await expectConnectReadsOnly(kerfdesk, 2);
});

test('a different unconfigured profile prompts after the current machine has been saved', async ({
  page,
}) => {
  const toolbar = machineToolbar(page);
  const setup = machineSetup(page);
  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(setup).toBeVisible();
  await expectConnected(toolbar);
  await saveSetup(setup);
  const saved = await configuredSignatures(page);
  expect(saved).toHaveLength(1);
  await toolbar.getByRole('button', { name: 'Disconnect', exact: true }).click();

  await page.evaluate(async () => {
    const stateUrl = '/src/ui/state/index.ts';
    const profilesUrl = '/src/core/devices/falcon-profiles.ts';
    const { useStore } = (await import(stateUrl)) as { useStore: { getState: () => AppState } };
    const { FALCON_A1_PRO_GRBLHAL_PROFILE } = (await import(profilesUrl)) as {
      FALCON_A1_PRO_GRBLHAL_PROFILE: DeviceProfile;
    };
    useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
  });
  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('Step 1 of 3');
  await expect(setup.getByRole('radio', { name: /Use Creality Falcon A1 Pro/ })).toBeChecked();
  await expectConnected(toolbar);
  expect(await configuredSignatures(page)).toEqual(saved);
});

test('background auto-connect opens only a granted mock port without opening Machine Setup', async ({
  page,
  kerfdesk,
}) => {
  expect(await configuredSignatures(page)).toEqual([]);
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-open')).toEqual([]);
  await page.evaluate(async () => {
    const adapterUrl = '/src/platform/web/index.ts';
    const hookUrl = '/src/ui/app/use-auto-connect-controller.ts';
    const { webAdapter } = (await import(adapterUrl)) as { webAdapter: PlatformAdapter };
    const { installAutoConnect } = (await import(hookUrl)) as {
      installAutoConnect: (platform: PlatformAdapter) => () => void;
    };
    // The standard serial fixture supplies this synthetic port. Make its
    // existing grant visible to the real auto-connect lifecycle.
    const port = await navigator.serial.requestPort();
    navigator.serial.getPorts = async () => [port];
    const stop = installAutoConnect(webAdapter);
    Object.defineProperty(window, '__FIRST_CONNECT_STOP_AUTO__', {
      configurable: true,
      value: stop,
    });
  });
  try {
    await expectConnected(machineToolbar(page));
    await expect(machineSetup(page)).toHaveCount(0);
    expect(await configuredSignatures(page)).toEqual([]);
    await expectConnectReadsOnly(kerfdesk);
    expect(
      (await kerfdesk.events()).filter((event) => event.kind === 'serial-request-port'),
    ).toHaveLength(1);
  } finally {
    await page.evaluate(() => {
      (
        window as typeof window & { __FIRST_CONNECT_STOP_AUTO__: () => void }
      ).__FIRST_CONNECT_STOP_AUTO__();
    });
  }
});

test('a saved laser setup does not suppress first Connect setup for the CNC head of the same machine', async ({
  page,
}) => {
  const toolbar = machineToolbar(page);
  const laserSetup = machineSetup(page);
  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(laserSetup).toBeVisible();
  await expectConnected(toolbar);
  await laserSetup.getByRole('radio', { name: /Laser \+ CNC/ }).check();
  await saveSetup(laserSetup);
  const saved = await configuredSignatures(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).not.toMatch(/:cnc$/);
  const deviceName = await currentDeviceName(page);
  await toolbar.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'CNC', exact: true }).click();
  expect(await currentDeviceName(page)).toBe(deviceName);

  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  const cncSetup = page.getByRole('dialog', { name: 'CNC Machine Setup', exact: true });
  await expect(cncSetup).toBeVisible();
  await expect(cncSetup).toContainText('Step 1 of 3');
  await expectConnected(toolbar);
  expect(await configuredSignatures(page)).toEqual(saved);
});

test('first FluidNC network Connect opens setup and returns focus to Machine details after cancellation', async ({
  page,
  kerfdesk,
}) => {
  await page.evaluate(async () => {
    const adapterUrl = '/src/platform/web/index.ts';
    const stateUrl = '/src/ui/state/index.ts';
    const { webAdapter } = (await import(adapterUrl)) as { webAdapter: PlatformAdapter };
    const { useStore } = (await import(stateUrl)) as { useStore: { getState: () => AppState } };
    const targets: { host: string; port: number }[] = [];
    Object.defineProperty(window, '__FIRST_CONNECT_NETWORK_TARGETS__', {
      configurable: true,
      value: targets,
    });
    Object.defineProperty(webAdapter, 'machineNetwork', {
      configurable: true,
      value: {
        serialForTarget: (host: string, port: number) => {
          targets.push({ host, port });
          return { isSupported: () => true, requestPort: async () => null };
        },
      },
    });
    const device = {
      ...useStore.getState().project.device,
      name: 'First-connect FluidNC fixture',
      controllerKind: 'fluidnc' as const,
    };
    delete device.controllerCommandSet;
    useStore.getState().replaceDeviceProfile(device);
  });
  const trigger = machineToolbar(page).getByRole('button', { name: /^Machine details:/ });
  await trigger.click();
  const details = page.getByRole('dialog', { name: 'Machine details', exact: true });
  await details
    .locator('summary')
    .filter({ hasText: /^FluidNC network connection$/ })
    .click();
  await details.getByRole('textbox', { name: 'FluidNC machine IP or hostname' }).fill('192.0.2.1');
  await details.getByRole('spinbutton', { name: 'FluidNC Telnet port' }).fill('23456');
  const connect = details.getByRole('button', { name: 'Connect FluidNC network', exact: true });
  await connect.focus();
  await connect.click();
  const setup = machineSetup(page);
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('Step 1 of 3');
  await expect(details).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __FIRST_CONNECT_NETWORK_TARGETS__: { host: string; port: number }[];
          }
        ).__FIRST_CONNECT_NETWORK_TARGETS__,
    ),
  ).toEqual([{ host: '192.0.2.1', port: 23456 }]);
  expect(await configuredSignatures(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-open')).toEqual([]);
});

test('menu Connect offers setup with the compact Machine rail collapsed', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1366, height: 668 });
  await page.getByRole('tab', { name: 'Machine', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand Laser panel', exact: true })).toBeVisible();
  const menuTrigger = page
    .getByRole('menubar', { name: 'Application menu', exact: true })
    .getByRole('menuitem', { name: 'Laser', exact: true });
  await menuTrigger.click();
  await page.getByRole('menuitem', { name: 'Connect', exact: true }).click();
  const setup = machineSetup(page);
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('Step 1 of 3');
  await expectConnected(machineToolbar(page));
  expect(await configuredSignatures(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);
  await expect(menuTrigger).toBeFocused();
  await expectConnectReadsOnly(kerfdesk);
});

function machineToolbar(page: Page): Locator {
  return page.getByRole('region', { name: 'Machine toolbar', exact: true });
}

function machineSetup(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Machine Setup', exact: true });
}

async function expectConnected(toolbar: Locator): Promise<void> {
  await expect(toolbar.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
  await expect(toolbar.getByRole('status').filter({ hasText: /^Connected$/ })).toBeVisible();
}

async function saveSetup(setup: Locator): Promise<void> {
  await setup.getByRole('button', { name: 'Review setup', exact: true }).click();
  await expect(setup).toContainText('Step 3 of 3');
  await setup.getByRole('button', { name: 'Save machine setup', exact: true }).click();
  await expect(setup).toHaveCount(0);
}

async function configuredSignatures(page: Page): Promise<readonly string[]> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '[]') as string[],
    CONFIGURED_KEY,
  );
}

async function currentDeviceName(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const stateUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(stateUrl)) as { useStore: { getState: () => AppState } };
    return useStore.getState().project.device.name;
  });
}

async function expectConnectReadsOnly(
  kerfdesk: KerfDeskFixture,
  openCount = 1,
  settingsRead = true,
): Promise<void> {
  if (settingsRead) {
    await expect
      .poll(async () =>
        (await kerfdesk.events()).some(
          (event) => event.kind === 'serial-write' && String(event['text']).includes('$$'),
        ),
      )
      .toBe(true);
  }
  const events = await kerfdesk.events();
  expect(events.filter((event) => event.kind === 'serial-open')).toHaveLength(openCount);
  const writes = events
    .filter((event) => event.kind === 'serial-write')
    .map((event) => String(event['text']));
  expect(
    writes.some((text) =>
      /(?:^|\n)\s*(?:\$J=|\$H\b|G(?:0?[0123]|38)\b|M[34]\b|\$\d+=)/i.test(text),
    ),
  ).toBe(false);
}
