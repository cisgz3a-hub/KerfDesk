import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { openMachineToolDropdown, selectWorkspacePanel } from './fixtures/workspace-ui';

// ADR-642: a running job adds its safety line, overrides and progress to the
// machine rail. The utility tabs box was the one row allowed to shrink to
// zero, so on a laptop-height window those rows were drawn over the Origin,
// Placement and Console tabs. The rail now scrolls instead. At 1280x720 the
// old rules left an 18 px box for 30 px tabs; below about 680 px the whole
// rail already scrolled, and above about 760 px everything fit.
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
  { width: 1280, height: 700 },
  { width: 1024, height: 560 },
]) {
  test(`a live job never draws over the machine tool tabs at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
    const setupHint = page.getByRole('button', { name: 'Not now', exact: true });
    if (await setupHint.isVisible()) await setupHint.click();
    await selectWorkspacePanel(page, 'Machine');
    await startStreamingJob(page);

    await expect(page.getByText('Pause is feed hold only.', { exact: false })).toBeAttached();
    await expectNoOverlap(page);
    await page.screenshot({ path: test.info().outputPath('live-job-rail.png') });

    // An open utility yields space down to its own floor, never below it.
    await openMachineToolDropdown(page, 'Console');
    await expectNoOverlap(page);
    await page.screenshot({ path: test.info().outputPath('live-job-rail-console.png') });
  });
}

async function startStreamingJob(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storePath = '/src/ui/state/laser-store.ts';
    const streamerPath = '/src/core/controllers/grbl/streamer.ts';
    const { useLaserStore } = (await import(/* @vite-ignore */ storePath)) as {
      useLaserStore: {
        getState: () => { capabilities: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    };
    const { createStreamer } = (await import(/* @vite-ignore */ streamerPath)) as {
      createStreamer: (gcode: string) => Record<string, unknown>;
    };
    useLaserStore.setState({
      connection: { kind: 'connected' },
      capabilities: {
        ...useLaserStore.getState().capabilities,
        realtimePause: true,
        overrides: true,
      },
      streamer: { ...createStreamer('G1 X1 S100\nG1 X2 S100\n'), status: 'streaming' },
    });
  });
}

/** Each row of the job controls starts at or below the end of the one before,
 * and the tabs box is at least as tall as its tabs. */
async function expectNoOverlap(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const controls = document.querySelector('.lf-machine-details > .lf-job-controls');
    const tools = controls?.querySelector(':scope > .lf-machine-tools');
    const tabs = tools?.querySelector('.lf-machine-tool-tabs');
    if (!controls || !tools || !tabs) return null;
    const rows = [...controls.children]
      .map((row) => row.getBoundingClientRect())
      .filter((rect) => rect.height > 0)
      .map((rect) => ({ top: rect.top, bottom: rect.bottom }));
    return {
      rows,
      toolsHeight: tools.getBoundingClientRect().height,
      tabsHeight: tabs.getBoundingClientRect().height,
    };
  });
  expect(layout).not.toBeNull();
  if (layout === null) return;
  expect(layout.toolsHeight).toBeGreaterThanOrEqual(layout.tabsHeight - 0.5);
  for (let index = 1; index < layout.rows.length; index += 1) {
    const previous = layout.rows[index - 1];
    const row = layout.rows[index];
    if (previous === undefined || row === undefined) continue;
    expect(row.top, `row ${index} starts inside row ${index - 1}`).toBeGreaterThanOrEqual(
      previous.bottom - 0.5,
    );
  }
}
