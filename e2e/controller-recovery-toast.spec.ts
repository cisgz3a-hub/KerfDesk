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
  test(`controller recovery floats over the canvas without shifting controls at ${viewport.width}px`, async ({
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

    // ADR-642: a controller that needs recovery opens the card by itself,
    // over the canvas, and the toolbar does not move.
    await setQualification(page, 'failed');
    const card = page.getByRole('alert', { name: 'Controller recovery', exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reconnect controller' })).toBeVisible();
    await expect(
      card.getByRole('button', { name: 'Retry reading controller settings' }),
    ).toBeVisible();
    await unchanged();
    const bounds = await card.boundingBox();
    if (bounds === null || toolbarBefore === null) throw new Error('Card must have bounds');
    expect(bounds.y).toBeGreaterThanOrEqual(toolbarBefore.y + toolbarBefore.height);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('controller-recovery-card.png') });

    // Folding keeps a row on the canvas until the controller recovers.
    await card.getByRole('button', { name: 'Collapse controller recovery' }).click();
    await expect(card).toHaveCount(0);
    const folded = page.getByRole('button', { name: /Machine stopped answering/ });
    await expect(folded).toBeVisible();
    await expect(folded).toBeFocused();
    await unchanged();
    await folded.click();
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Collapse controller recovery' })).toBeFocused();

    // Controller info in the menu still shows the same details.
    const trigger = page.getByRole('button', { name: 'More connection options', exact: true });
    await trigger.click();
    const info = page.getByRole('menuitem', { name: 'Controller info', exact: true });
    await info.click();
    const details = page.getByRole('dialog', { name: 'Controller information', exact: true });
    await expect(details).toContainText('Machine stopped answering');
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await unchanged();

    // Reading settings after a reset is routine: it never pops up (ADR-611).
    for (const phase of ['controller-response', 'reset-cleanup', 'settings-read'] as const) {
      await setQualification(page, 'qualifying', phase);
      await expect(card).toHaveCount(0);
      await expect(folded).toHaveCount(0);
      await expect(details).toHaveCount(0);
      await unchanged();
    }
    await trigger.click();
    await info.click();
    await expect(details).toContainText('Reading controller settings…');
    await setQualification(page, 'qualified');
    await expect(details).toHaveCount(0);
    await expect(card).toHaveCount(0);
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
