import { expect, test, type Page } from './fixtures/kerfdesk-test';

test('CNC review separates configured spindle values from live controller scale', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Machine Setup', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);

  await seedReview(page, { ceiling: 12000, live: 12000 });
  const dialog = page.getByRole('dialog', { name: 'Review job before starting', exact: true });
  const controller = dialog.locator('details').filter({ hasText: 'Controller —' });
  await controller.locator('summary').click();
  const sMax = controller
    .locator('dt')
    .filter({ hasText: /^S max \$30$/ })
    .locator('..');
  await expect(sMax.locator('dd')).toHaveText('12000');
  await expect(sMax.locator('dd')).not.toHaveAttribute('style', /--lf-warning-fg/);

  await seedReview(page, { ceiling: 12000, live: 1000 });
  await expect(sMax.locator('dd')).toHaveText('1000 — profile expects 12000');
  await expect(sMax.locator('dd')).toHaveAttribute('style', /--lf-warning-fg/);
  await dialog.screenshot({ path: testInfo.outputPath('cnc-controller-mismatch.png') });

  await seedReview(page, { ceiling: 6000, live: null });
  const warnings = dialog.locator('details').filter({ hasText: /^Warnings/ });
  await warnings.locator('summary').click();
  await expect(warnings).toContainText('Spindle maximum is 6000 RPM');
  await expect(warnings).toContainText('actual spindle RPM is not measured');
  await expect(controller).toContainText('Not read this session');
  await expect(dialog.getByRole('button', { name: 'Start job', exact: true })).toBeEnabled();
  await dialog.screenshot({ path: testInfo.outputPath('cnc-offline-spindle-warning.png') });
  // This is a seeded review-only fixture: never confirm, Frame, connect, or stream.
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial'))).toEqual([]);
  expect(errors).toEqual([]);
});

async function seedReview(
  page: Page,
  values: { readonly ceiling: number; readonly live: number | null },
): Promise<void> {
  await page.evaluate(async ({ ceiling, live }) => {
    const scenePath = '/src/core/scene/index.ts';
    const statePath = '/src/ui/state/store.ts';
    const laserPath = '/src/ui/state/laser-store.ts';
    const reviewPath = '/src/ui/laser/job-review/job-review-store.ts';
    const warningsPath = '/src/ui/laser/machine-job-warnings.ts';
    // Runtime module contracts are deliberately narrow: the runner TS project
    // must not pull in the app's separate Vite globals and browser library set.
    const scene = (await import(scenePath)) as {
      createProject: () => object;
      createLayer: (args: { id: string; color: string }) => object;
      DEFAULT_CNC_MACHINE_CONFIG: { params: object };
      DEFAULT_CNC_LAYER_SETTINGS: object;
    };
    const { useStore } = (await import(statePath)) as {
      useStore: { setState: (patch: object) => void };
    };
    const { useLaserStore } = (await import(laserPath)) as {
      useLaserStore: { setState: (patch: object) => void };
    };
    const { useJobReviewStore } = (await import(reviewPath)) as {
      useJobReviewStore: {
        getState: () => {
          state: { kind: string };
          open: (model: object) => boolean;
          completePrepare: (model: object) => void;
        };
      };
    };
    const { detectMachineJobWarnings } = (await import(warningsPath)) as {
      detectMachineJobWarnings: (project: object, settings: object | null) => readonly string[];
    };
    const project = {
      ...scene.createProject(),
      machine: {
        ...scene.DEFAULT_CNC_MACHINE_CONFIG,
        params: { ...scene.DEFAULT_CNC_MACHINE_CONFIG.params, spindleMaxRpm: ceiling },
      },
      scene: {
        objects: [],
        layers: [
          {
            ...scene.createLayer({ id: 'cnc', color: '#ff0000' }),
            cnc: { ...scene.DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: 12000 },
          },
        ],
      },
    };
    const settings = live === null ? null : { maxPowerS: live };
    useStore.setState({ project });
    useLaserStore.setState({ connection: { kind: 'connected' }, controllerSettings: settings });
    const model = {
      machineKind: 'cnc',
      stats: [],
      warnings: detectMachineJobWarnings(project, settings),
      resolvedOriginLabel: 'Review-only browser fixture',
      toolPlanLabels: [],
      acknowledgement: { kind: 'cnc', prompt: 'Review fixture — no machine is connected.' },
      outputQualityFacts: [],
      effectiveOperations: [],
    } as const;
    if (useJobReviewStore.getState().state.kind === 'idle') {
      useJobReviewStore.getState().open(model);
    } else {
      useJobReviewStore.getState().completePrepare(model);
    }
  }, values);
}
