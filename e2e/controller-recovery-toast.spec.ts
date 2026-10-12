import { expect, test, type Page } from './fixtures/kerfdesk-test';

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 640, height: 450 },
  { width: 600, height: 450 },
  { width: 420, height: 600 },
]) {
  test(`controller recovery floats without shifting the connection bar at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
    // A longer profile at the row's tight boundary exposes the same wrapping
    // that wider system fonts produced in the 640 px Linux CI run.
    if (viewport.width === 600) await setMachineName(page, 'Creality Falcon A1 Pro');
    const setupHint = page.getByRole('button', { name: 'Not now', exact: true });
    if (await setupHint.isVisible()) await setupHint.click();
    const machineTab = page.getByRole('tab', { name: 'Machine', exact: true });
    if (await machineTab.isVisible()) await machineTab.click();
    const expand = page.getByRole('button', { name: 'Expand Laser panel', exact: true });
    if (await expand.isVisible()) await expand.click();
    await setQualification(page, 'qualified');
    const row = page.getByRole('button', { name: 'Disconnect', exact: true }).locator('..');
    const before = await row.boundingBox();
    expect(before).not.toBeNull();

    await setQualification(page, 'failed');
    const toast = page.getByRole('alert', { name: 'Controller information', exact: true });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS('position', 'fixed');
    const after = await row.boundingBox();
    expect(after?.y).toBe(before?.y);
    expect(after?.height).toBe(before?.height);
    const bounds = await toast.boundingBox();
    if (bounds === null) throw new Error('Recovery toast must have visible bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);

    await page.screenshot({ path: test.info().outputPath('controller-recovery-toast.png') });
    await page.getByRole('button', { name: 'Dismiss controller notification' }).click();
    await expect(toast).toHaveCount(0);
    const trigger = page.getByRole('button', { name: 'Controller info', exact: true });
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Dismiss controller notification' }).focus();
    await page.keyboard.press('Escape');
    await expect(toast).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await setQualification(page, 'qualifying');
    await expect(page.getByText('Reading controller settings…', { exact: true })).toBeVisible();
    expect((await row.boundingBox())?.height).toBe(before?.height);
    await setQualification(page, 'qualified');
    await expect(trigger).toHaveCount(0);
  });
}

async function setMachineName(page: Page, name: string) {
  await page.evaluate(async (machineName) => {
    const modulePath = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ modulePath)) as {
      useStore: {
        getState: () => { project: { device: Record<string, unknown> } };
        setState: (state: Record<string, unknown>) => void;
      };
    };
    const { project } = useStore.getState();
    useStore.setState({
      project: { ...project, device: { ...project.device, name: machineName } },
    });
  }, name);
}

async function setQualification(page: Page, kind: 'qualified' | 'qualifying' | 'failed') {
  await page.evaluate(async (qualificationKind) => {
    const modulePath = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(/* @vite-ignore */ modulePath)) as {
      useLaserStore: { setState: (state: Record<string, unknown>) => void };
    };
    useLaserStore.setState({
      connection: { kind: 'connected' },
      controllerSessionEpoch: 4,
      controllerQualification: {
        kind: qualificationKind,
        epoch: 4,
        settings: 'verified',
        phase: 'settings-read',
        message: 'No controller response was received. Check the cable and controller, then retry.',
      },
    });
  }, kind);
}
