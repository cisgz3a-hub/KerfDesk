import { test, expect, type Page } from './fixtures/kerfdesk-test';
import type { AppState } from '../src/ui/state';
import type { DeviceProfile } from '../src/core/devices';

test('machine details retains focus when a same-name mode switch removes its module control', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await prepareModuleProfile(page);
  const trigger = page.getByRole('button', { name: /^Machine details:/ });
  await trigger.click();
  const popup = page.getByRole('dialog', { name: 'Machine details', exact: true });
  const module = popup.getByRole('combobox', { name: 'Laser module', exact: true });
  await expect(module).toBeFocused();
  await recordNativeFocusEvents(page);
  const names = await switchToCnc(page);
  expect(names.after).toBe(names.before);
  await expect(module).toHaveCount(0);
  await expect(popup).toBeVisible();
  await expect(
    popup.getByRole('button', { name: 'Close machine details', exact: true }),
  ).toBeFocused();
  await testInfo.attach('native-module-removal-focus', {
    body: JSON.stringify(await readNativeFocusEvents(page)),
    contentType: 'application/json',
  });
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});

test('outside focus dismisses machine details and survives a later mode change', async ({
  page,
  kerfdesk,
}) => {
  await prepareModuleProfile(page);
  await page.getByRole('button', { name: /^Machine details:/ }).click();
  const popup = page.getByRole('dialog', { name: 'Machine details', exact: true });
  await expect(popup.getByRole('combobox', { name: 'Laser module', exact: true })).toBeFocused();
  const outside = page.getByRole('button', { name: 'Machine Setup', exact: true });
  await outside.focus();
  await expect(popup).toHaveCount(0);
  await switchToCnc(page);
  await expect(outside).toBeFocused();
  await expect(popup).toHaveCount(0);
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});

async function prepareModuleProfile(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 668 });
  await page.goto('/');
  await page.getByRole('region', { name: 'Machine toolbar', exact: true }).waitFor();
  await page.evaluate(async () => {
    const stateUrl = '/src/ui/state/index.ts';
    const profilesUrl = '/src/core/devices/falcon-profiles.ts';
    const { useStore } = (await import(stateUrl)) as { useStore: { getState: () => AppState } };
    const { FALCON_A1_PRO_GRBLHAL_PROFILE } = (await import(profilesUrl)) as {
      FALCON_A1_PRO_GRBLHAL_PROFILE: DeviceProfile;
    };
    useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    useStore.getState().setMachineKind('laser');
  });
}

async function switchToCnc(page: Page): Promise<{ before: string; after: string }> {
  return page.evaluate(async () => {
    const stateUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(stateUrl)) as { useStore: { getState: () => AppState } };
    const before = useStore.getState().project.device.name;
    useStore.getState().setMachineKind('cnc');
    return { before, after: useStore.getState().project.device.name };
  });
}

interface FocusEvidence {
  readonly type: string;
  readonly target: string | null;
  readonly next: string | null;
}

async function recordNativeFocusEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const evidence: FocusEvidence[] = [];
    const auditWindow = window as typeof window & { machineDetailsFocusEvidence?: FocusEvidence[] };
    auditWindow.machineDetailsFocusEvidence = evidence;
    for (const type of ['focusin', 'focusout']) {
      document.addEventListener(
        type,
        (event) => {
          if (!(event instanceof FocusEvent)) return;
          evidence.push({
            type: event.type,
            target:
              event.target instanceof Element ? event.target.getAttribute('aria-label') : null,
            next:
              event.relatedTarget instanceof Element
                ? event.relatedTarget.getAttribute('aria-label')
                : null,
          });
        },
        true,
      );
    }
  });
}

async function readNativeFocusEvents(page: Page): Promise<FocusEvidence[]> {
  return page.evaluate(
    () =>
      (window as typeof window & { machineDetailsFocusEvidence?: FocusEvidence[] })
        .machineDetailsFocusEvidence ?? [],
  );
}
