import { expect, test, type Page } from './fixtures/kerfdesk-test';

type Phase = 'controller-response' | 'reset-cleanup' | 'settings-read';

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 640, height: 450 },
  { width: 600, height: 450 },
  { width: 560, height: 450 },
  { width: 420, height: 600 },
]) {
  test(`controller recovery floats without shifting the connection bar at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
    // A longer profile exposes the same tight row boundary as wider CI fonts.
    if (viewport.width === 600) await setMachineName(page, 'Creality Falcon A1 Pro');
    const setupHint = page.getByRole('button', { name: 'Not now', exact: true });
    if (await setupHint.isVisible()) await setupHint.click();
    await setQualification(page, 'qualified');
    const row = page.getByRole('button', { name: 'Disconnect', exact: true }).locator('..');
    const toolbar = page.locator('.lf-workspace-topbar');
    const before = await row.boundingBox();
    const toolbarBefore = await toolbar.boundingBox();
    expect(before).not.toBeNull();
    expect(toolbarBefore).not.toBeNull();
    const unchanged = async () => {
      await expect.poll(() => row.boundingBox()).toEqual(before);
      await expect.poll(() => toolbar.boundingBox()).toEqual(toolbarBefore);
    };

    await setQualification(page, 'failed');
    const toast = page.getByRole('alert', { name: 'Controller information', exact: true });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS('position', 'fixed');
    await unchanged();
    const bounds = await toast.boundingBox();
    if (bounds === null) throw new Error('Recovery toast must have visible bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);

    await page.screenshot({ path: test.info().outputPath('controller-recovery-toast.png') });
    await page.getByRole('button', { name: 'Dismiss controller notification' }).click();
    await expect(toast).toHaveCount(0);
    const trigger = page.getByRole('button', { name: 'More connection options', exact: true });
    await expect(trigger).toBeFocused();
    await unchanged();
    await page.keyboard.press('Enter');
    const info = page.getByRole('menuitem', { name: 'Controller info', exact: true });
    await expect(info).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toast).toBeVisible();
    await expect(
      toast.getByRole('button', { name: 'Dismiss controller notification' }),
    ).toBeFocused();
    await unchanged();
    await page.keyboard.press('Escape');
    await expect(toast).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await unchanged();

    for (const phase of ['controller-response', 'reset-cleanup', 'settings-read'] as const) {
      await setQualification(page, 'qualifying', phase);
      const progress = page.getByRole('status', { name: 'Controller information', exact: true });
      await expect(progress).toBeVisible();
      await expect(progress).toHaveCSS('position', 'fixed');
      await expect(progress).toContainText(
        phase === 'settings-read'
          ? 'Reading controller settings…'
          : 'Wait for the previous controller write and acknowledgement before reading machine settings.',
      );
      await unchanged();
    }
    await setQualification(page, 'qualified');
    await expect(
      page.getByRole('status', { name: 'Controller information', exact: true }),
    ).toHaveCount(0);
    await trigger.click();
    await expect(info).toHaveCount(0);
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

async function setQualification(
  page: Page,
  kind: 'qualified' | 'qualifying' | 'failed',
  phase: Phase = 'settings-read',
) {
  await page.evaluate(
    async ({ qualificationKind, qualificationPhase }) => {
      const modulePath = '/src/ui/state/laser-store.ts';
      const { useLaserStore } = (await import(/* @vite-ignore */ modulePath)) as {
        useLaserStore: { setState: (state: Record<string, unknown>) => void };
      };
      useLaserStore.setState({
        connection: { kind: 'connected' },
        controllerSessionEpoch: 4,
        pendingUntrackedAcks: qualificationKind === 'qualified' ? 0 : 1,
        controllerQualification: {
          kind: qualificationKind,
          epoch: 4,
          settings: 'verified',
          phase: qualificationPhase,
          message:
            'No controller response was received. Check the cable and controller, then retry.',
        },
      });
    },
    { qualificationKind: kind, qualificationPhase: phase },
  );
}
