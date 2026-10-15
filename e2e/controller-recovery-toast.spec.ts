import { expect, test, type Page } from './fixtures/kerfdesk-test';

type Phase = 'controller-response' | 'reset-cleanup' | 'settings-read';

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 1240, height: 800 },
  { width: 640, height: 450 },
  { width: 600, height: 450 },
  { width: 560, height: 450 },
  { width: 420, height: 600 },
  { width: 360, height: 640 },
]) {
  test(`controller notices stay in the toolbar without shifting controls at ${viewport.width}px`, async ({
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
    const brief = page.getByRole('group', { name: 'Controller notification', exact: true });
    const toast = page.getByRole('alert', { name: 'Controller information', exact: true });
    await expect(brief).toBeVisible();
    await expect(toast).toHaveCount(0);
    await unchanged();
    const bounds = await brief.boundingBox();
    const mode = await page.locator('.lf-machine-toolbar .lf-machine-mode').boundingBox();
    if (bounds === null || mode === null || toolbarBefore === null)
      throw new Error('Toolbar notice must have visible bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(mode.x);
    expect(bounds.y).toBeGreaterThanOrEqual(toolbarBefore.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(toolbarBefore.y + toolbarBefore.height);
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeInViewport();

    await page.screenshot({ path: test.info().outputPath('controller-recovery-toast.png') });
    // Expiry never moves focus from the user's current control.
    const trigger = page.getByRole('button', { name: 'More connection options', exact: true });
    await trigger.focus();
    await expect(brief).toHaveCount(0, { timeout: 8000 });
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

    await trigger.click();
    await info.click();
    const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
    await disconnect.focus();
    await expect(toast).toHaveCount(0);
    await expect(disconnect).toBeFocused();

    for (const phase of ['controller-response', 'reset-cleanup', 'settings-read'] as const) {
      await setQualification(page, 'qualifying', phase);
      const progress = page.getByRole('group', { name: 'Controller notification', exact: true });
      await expect(progress).toBeVisible();
      await expect(progress).toContainText(
        phase === 'settings-read'
          ? 'Reading controller settings…'
          : 'Waiting to read controller settings…',
      );
      await expect(
        page.getByRole('dialog', { name: 'Controller information', exact: true }),
      ).toHaveCount(0);
      await unchanged();
    }
    await page.screenshot({ path: test.info().outputPath('controller-waiting-toolbar.png') });
    await brief.getByRole('button').click();
    await expect(
      page.getByRole('dialog', { name: 'Controller information', exact: true }),
    ).toContainText('Reading controller settings…');
    await setQualification(page, 'qualified');
    await expect(trigger).toBeFocused();
    await expect(
      page.getByRole('group', { name: 'Controller notification', exact: true }),
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
