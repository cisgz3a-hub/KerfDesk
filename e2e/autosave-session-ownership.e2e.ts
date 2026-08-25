import { expect, test } from '@playwright/test';

const SHARED_SESSION_ID = 'browser-shared-session';

test('real Web Locks rotate contended writers and protect foreign cleanup', async ({ page }) => {
  test.setTimeout(90_000);
  await seedSessionId(page, SHARED_SESSION_ID);
  await page.goto('/');

  const first = await page.evaluate(async () => {
    const autosavePath = '/src/ui/state/autosave-durable.ts';
    const scenePath = '/src/core/scene/index.ts';
    const autosave = (await import(/* @vite-ignore */ autosavePath)) as AutosaveModule;
    const scene = (await import(/* @vite-ignore */ scenePath)) as SceneModule;
    const session = await autosave.projectAutosaveService.session();
    const project = { ...scene.createProject(), notes: 'live foreign browser project' };
    const write = await autosave.projectAutosaveService.write(project, 100);
    return { sessionId: session.sessionId, ownership: session.ownership, write };
  });
  expect(first).toMatchObject({
    sessionId: SHARED_SESSION_ID,
    ownership: 'owned',
    write: { kind: 'ok', backend: 'indexeddb' },
  });

  const secondPage = await page.context().newPage();
  await seedSessionId(secondPage, SHARED_SESSION_ID);
  await secondPage.goto('/');
  const second = await secondPage.evaluate(async () => {
    const autosavePath = '/src/ui/state/autosave-durable.ts';
    const autosave = (await import(/* @vite-ignore */ autosavePath)) as AutosaveModule;
    const session = await autosave.projectAutosaveService.session();
    const read = await autosave.projectAutosaveService.readLatest();
    return { sessionId: session.sessionId, ownership: session.ownership, snapshot: read.snapshot };
  });
  expect(second.ownership).toBe('owned');
  expect(second.sessionId).not.toBe(SHARED_SESSION_ID);
  expect(second.snapshot).toBeNull();

  await page.close();
  await expect
    .poll(() => captureAbandonedSnapshot(secondPage), { timeout: 10_000 })
    .toBe('live foreign browser project');
  const abandoned = await secondPage.evaluate(() => {
    const snapshot = (window as AutosaveTestWindow).__autosaveRecoveredSnapshot;
    if (snapshot === undefined) throw new Error('Expected the closed window autosave.');
    return {
      notes: snapshot.project.notes,
      ownership: snapshot.ownership,
      sessionId: snapshot.sessionId,
    };
  });
  expect(abandoned).toEqual({
    notes: 'live foreign browser project',
    ownership: 'abandoned',
    sessionId: SHARED_SESSION_ID,
  });

  await holdRawSessionLock(secondPage, SHARED_SESSION_ID);
  const retained = await clearCapturedSnapshot(secondPage);
  expect(retained).toEqual({ kind: 'retained', reason: 'live' });
  await releaseRawSessionLock(secondPage);

  expect(await clearCapturedSnapshot(secondPage)).toEqual({ kind: 'ok' });
  const remaining = await secondPage.evaluate(async () => {
    const autosavePath = '/src/ui/state/autosave-durable.ts';
    const autosave = (await import(/* @vite-ignore */ autosavePath)) as AutosaveModule;
    return (await autosave.projectAutosaveService.readLatest()).snapshot;
  });
  expect(remaining).toBeNull();
});

interface AutosaveSnapshot {
  readonly project: { readonly notes: string };
  readonly ownership: string;
  readonly sessionId?: string;
}

interface AutosaveModule {
  readonly projectAutosaveService: {
    session(): Promise<{ readonly sessionId: string; readonly ownership: string }>;
    write(project: object, savedAt?: number): Promise<object>;
    readLatest(): Promise<{ readonly snapshot: AutosaveSnapshot | null }>;
    clearRecovered(snapshot: AutosaveSnapshot): Promise<object>;
  };
}

interface SceneModule {
  readonly createProject: () => object;
}

type AutosaveTestWindow = Window & {
  __autosaveRecoveredSnapshot?: AutosaveSnapshot;
  __autosaveTestLock?: {
    readonly release: () => void;
    readonly completion: Promise<void>;
  };
};

async function seedSessionId(page: import('@playwright/test').Page, sessionId: string) {
  await page.addInitScript((value) => {
    sessionStorage.setItem('lf2:autosave:session-id:v1', value);
  }, sessionId);
}

async function holdRawSessionLock(
  page: import('@playwright/test').Page,
  sessionId: string,
): Promise<void> {
  await page.evaluate(async (value) => {
    const lockPath = '/src/ui/state/autosave-session-lock.ts';
    const loaded = (await import(/* @vite-ignore */ lockPath)) as {
      readonly autosaveSessionLockName: (sessionId: string) => string;
    };
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired = (): void => undefined;
    const acquiredPromise = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const completion = navigator.locks
      .request(loaded.autosaveSessionLockName(value), { mode: 'exclusive' }, () => {
        acquired();
        return held;
      })
      .then(() => undefined);
    (window as AutosaveTestWindow).__autosaveTestLock = { release, completion };
    await acquiredPromise;
  }, sessionId);
}

async function releaseRawSessionLock(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const held = (window as AutosaveTestWindow).__autosaveTestLock;
    if (held === undefined) throw new Error('Expected a held autosave test lock.');
    held.release();
    await held.completion;
  });
}

async function clearCapturedSnapshot(page: import('@playwright/test').Page): Promise<object> {
  return page.evaluate(async () => {
    const snapshot = (window as AutosaveTestWindow).__autosaveRecoveredSnapshot;
    if (snapshot === undefined) throw new Error('Expected a captured autosave snapshot.');
    const autosavePath = '/src/ui/state/autosave-durable.ts';
    const autosave = (await import(/* @vite-ignore */ autosavePath)) as AutosaveModule;
    return autosave.projectAutosaveService.clearRecovered(snapshot);
  });
}

async function captureAbandonedSnapshot(
  page: import('@playwright/test').Page,
): Promise<string | null> {
  return page.evaluate(async () => {
    const autosavePath = '/src/ui/state/autosave-durable.ts';
    const autosave = (await import(/* @vite-ignore */ autosavePath)) as AutosaveModule;
    const snapshot = (await autosave.projectAutosaveService.readLatest()).snapshot;
    if (snapshot !== null) {
      (window as AutosaveTestWindow).__autosaveRecoveredSnapshot = snapshot;
    }
    return snapshot?.project.notes ?? null;
  });
}
