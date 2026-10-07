import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { importComposedSvg, composedSvgSnapshot } from './fixtures/composed-svg-browser';
import { runMenuCommand } from './fixtures/recovery-flow';
import { selectWorkspacePanel } from './fixtures/workspace-ui';

for (const mode of ['laser', 'cnc'] as const) {
  test(`prepared ${mode} omissions reveal only matching artwork in the browser`, async ({
    page,
    kerfdesk,
  }, info) => {
    test.setTimeout(120_000);
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    if (mode === 'laser') {
      await importComposedSvg(
        page,
        kerfdesk,
        'omission-review.svg',
        '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path fill="none" stroke="#000000" d="M10 10 C20 10 20 20 10 20 L10.25 10.25"/><rect fill="#ff0000" x="30" y="30" width="8" height="8"/></svg>',
        2,
      );
      await runMenuCommand(page, 'Edit', 'Select All');
      await selectWorkspacePanel(page, 'Artwork');
      const panel = page.getByRole('complementary', {
        name: 'Artwork / Operations panel',
        exact: true,
      });
      // Import preserves the black and red artwork as separate operations.
      await panel
        .getByRole('button', { name: 'Use one operation for selection', exact: true })
        .click();
      const fill = panel
        .getByRole('radiogroup', { name: 'Mode for selected objects', exact: true })
        .getByRole('radio', { name: 'Fill', exact: true });
      await expect(fill).toBeVisible();
      await fill.check();
      await expect(fill).toBeChecked();
    }
    const prepared = await openPreparedReview(page, mode);
    const before = await composedSvgSnapshot(page);
    expect(await selectedIds(page)).toEqual(prepared.initialSelection);
    const review = page.getByRole('dialog', { name: 'Review job before starting', exact: true });
    await expect(review).toBeVisible();
    await expect(review).toContainText(/open.*contour|open.*path/i);
    await expect(review.getByRole('button', { name: 'Start job', exact: true })).toBeEnabled();
    await expect(
      review.getByRole('button', { name: 'Show omitted artwork', exact: true }),
    ).toBeVisible();
    expect(prepared.omissions.length).toBe(mode === 'laser' ? 1 : 2);
    await review.screenshot({ path: info.outputPath(`${mode}-omission-review.png`) });
    if (mode === 'cnc')
      expect(workers.some((url) => url.includes('output-preparation'))).toBe(true);
    await review.getByRole('button', { name: 'Show omitted artwork', exact: true }).click();
    await expect(review).not.toBeVisible();
    await expect.poll(async () => selectedIds(page)).toEqual(prepared.omissions);
    const after = await composedSvgSnapshot(page);
    expect(await viewZoom(page)).toBeGreaterThan(prepared.initialZoom);
    expect(after.project.scene).toEqual(before.project.scene);
    expect(after.undoCount).toBe(before.undoCount);
    await expect(
      page.getByRole('complementary', { name: 'Artwork / Operations panel', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${mode}-revealed-artwork.png`) });
    writeFileSync(
      info.outputPath(`${mode}-review-evidence.json`),
      JSON.stringify(prepared, null, 2),
    );
    expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial'))).toEqual(
      [],
    );
  });
}

async function openPreparedReview(page: Page, mode: 'laser' | 'cnc') {
  // This is a prepared-review UI workflow, not a run permit. The real snapshot
  // compiler (and CNC worker) runs, but Frame/Start/serial are never invoked.
  return page.evaluate(async (mode) => {
    const modules = [
      '/src/ui/state/store.ts',
      '/src/ui/state/laser-store.ts',
      '/src/ui/state/camera-store.ts',
      '/src/ui/state/laser-mode-start-evidence.ts',
      '/src/ui/laser/start-job-source.ts',
      '/src/ui/laser/job-review/job-review-model.ts',
      '/src/ui/laser/job-review/job-review-store.ts',
      '/src/core/scene/index.ts',
      '/src/ui/state/ui-store.ts',
    ];
    const loaded = await Promise.all(modules.map((url) => import(/* @vite-ignore */ url)));
    const appStore = loaded[0] as {
      useStore: {
        getState: () => {
          project: unknown;
          selectedObjectId: string | null;
          additionalSelectedIds: ReadonlySet<string>;
        };
        setState: (patch: object) => void;
      };
    };
    const laserStore = loaded[1] as {
      useLaserStore: { getState: () => unknown; setState: (patch: object) => void };
    };
    const cameraStore = loaded[2] as { useCameraStore: { getState: () => unknown } };
    const evidence = loaded[3] as { captureLaserModeStartSnapshot: (state: unknown) => unknown };
    const source = loaded[4] as {
      prepareCurrentStartJob: (
        app: unknown,
        laser: unknown,
        camera: unknown,
        origin: undefined,
        requireFrame: boolean,
      ) => Promise<{
        ok: boolean;
        messages?: readonly string[];
        gcode?: string;
        warnings?: readonly string[];
      }>;
    };
    const models = loaded[5] as {
      buildJobReviewModel: (args: object) => {
        warnings: readonly string[];
        openFillOmissions?: { objectIds: readonly string[] };
        openCncContourOmissions?: { objectIds: readonly string[] };
      };
    };
    const reviewStore = loaded[6] as {
      useJobReviewStore: { getState: () => { open: (model: object) => void } };
    };
    const scene = loaded[7] as { DEFAULT_OUTPUT_SCOPE: object };
    const uiStore = loaded[8] as {
      useUiStore: { getState: () => { resetView: () => void; zoomFactor: number } };
    };
    uiStore.useUiStore.getState().resetView();
    const initialZoom = uiStore.useUiStore.getState().zoomFactor;
    if (mode === 'cnc') {
      const fixtureUrl = '/src/__fixtures__/cnc-open-contours.ts';
      const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as {
        cncOmissionProject: () => unknown;
      };
      appStore.useStore.setState({
        project: fixture.cncOmissionProject(),
        selectedObjectId: 'closed-square',
        additionalSelectedIds: new Set(),
        undoStack: [],
        redoStack: [],
        dirty: false,
      });
    }
    laserStore.useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        feed: 0,
        spindle: 0,
        wco: null,
      },
      // Prepared-review fixture: an existing G92 XY origin at this reported position.
      // No Set Origin command, Frame, or Start is dispatched by this workflow.
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 0, y: 0, z: 0 },
      controllerSessionEpoch: 7,
      controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
      controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: mode === 'laser' },
      controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    });
    const app = appStore.useStore.getState();
    const laser = laserStore.useLaserStore.getState();
    const prepared = await source.prepareCurrentStartJob(
      app,
      laser,
      cameraStore.useCameraStore.getState(),
      undefined,
      false,
    );
    if (!prepared.ok)
      throw new Error('Prepared review failed: ' + (prepared.messages ?? []).join(' / '));
    const model = models.buildJobReviewModel({
      project: app.project,
      prepared,
      outputScope: scene.DEFAULT_OUTPUT_SCOPE,
      laserModeStartSnapshot: evidence.captureLaserModeStartSnapshot(laser),
      overrides: null,
    });
    reviewStore.useJobReviewStore.getState().open(model);
    return {
      initialZoom,
      warnings: model.warnings,
      gcode: prepared.gcode,
      omissions: [
        ...(mode === 'laser'
          ? (model.openFillOmissions?.objectIds ?? [])
          : (model.openCncContourOmissions?.objectIds ?? [])),
      ],
      initialSelection: [app.selectedObjectId, ...app.additionalSelectedIds].filter(
        (id): id is string => id !== null,
      ),
    };
  }, mode);
}

async function selectedIds(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const loaded = (await import(/* @vite-ignore */ path)) as {
      useStore: {
        getState: () => {
          selectedObjectId: string | null;
          additionalSelectedIds: ReadonlySet<string>;
        };
      };
    };
    const state = loaded.useStore.getState();
    return [
      ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
      ...state.additionalSelectedIds,
    ];
  });
}

async function viewZoom(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const path = '/src/ui/state/ui-store.ts';
    const loaded = (await import(/* @vite-ignore */ path)) as {
      useUiStore: { getState: () => { zoomFactor: number } };
    };
    return loaded.useUiStore.getState().zoomFactor;
  });
}
