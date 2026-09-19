import * as fs from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertBuildMetadata,
  assertEvidencePath,
  assertHostedWindows,
  assertInsideWindows,
  assertPreflight,
  assertRoundtrip,
  evidenceParents,
  FIXTURE_NAME,
  FIXTURE_SVG,
  parseArgs,
  prepareProfile,
  sha256,
  summarizeDialogResults,
  validateProject,
} from './installed-app-evidence.mjs';
import {
  bounded,
  cleanupOwnedApp,
  closeInstalledApp,
  findDebugger,
  launchInstalledApp,
  runNativeHelper,
  waitUntil,
} from './installed-app-process.mjs';

async function createContext(args) {
  assertHostedWindows(process.platform, process.env);
  assertEvidencePath(args['output-root'], evidenceParents(process.env));
  assertInsideWindows(process.env.RUNNER_TEMP, args.executable);
  assertInsideWindows(process.env.RUNNER_TEMP, args.project);
  await fs.mkdir(args['output-root'], { recursive: true });
  const actualParents = await Promise.all(
    evidenceParents(process.env).map((parent) =>
      fs.realpath(parent).catch((error) => {
        if (error.code === 'ENOENT') return parent;
        throw error;
      }),
    ),
  );
  assertEvidencePath(await fs.realpath(args['output-root']), actualParents);
  const context = {
    args,
    app: null,
    browser: null,
    page: null,
    manifest: {
      schemaVersion: 1,
      status: 'running',
      outcome: 'running',
      startedAt: new Date().toISOString(),
      phase: args.phase,
      executable: args.executable,
      expectedProfile: args['expected-profile'],
      project: args.project,
      workflowRunId: process.env.GITHUB_RUN_ID,
      stages: [],
      rendererErrors: [],
      uiEvents: [],
      dialogAttempts: [],
      failure: null,
    },
  };
  await fs.writeFile(
    join(args['output-root'], 'result.json'),
    JSON.stringify(context.manifest, null, 2),
    { flag: 'wx' },
  );
  return context;
}

async function stage(context, name, operation) {
  const entry = { name, startedAt: new Date().toISOString(), outcome: 'running' };
  context.manifest.stages.push(entry);
  try {
    const result = await operation();
    entry.outcome = 'success';
    return result;
  } catch (error) {
    entry.outcome = 'failure';
    entry.error = error.message;
    throw error;
  } finally {
    entry.finishedAt = new Date().toISOString();
  }
}

async function preflight(context) {
  const { args, manifest } = context;
  const probe = await runNativeHelper(args, 'Preflight', 'preflight');
  assertPreflight(args, probe, process.env);
  manifest.preflight = probe;
  manifest.executableSha256 = sha256(await fs.readFile(args.executable));
  await fs.mkdir(dirname(args.project), { recursive: true });
  assertInsideWindows(
    await fs.realpath(process.env.RUNNER_TEMP),
    await fs.realpath(dirname(args.project)),
  );
  if (args.phase === 'create') {
    const present = await fs.stat(args.project).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (present)
      throw new Error('Create requires a new project path; refusing to overwrite a file');
    await fs.writeFile(join(args['output-root'], FIXTURE_NAME), FIXTURE_SVG, { flag: 'wx' });
  } else {
    context.originalBytes = await fs.readFile(args.project);
    context.originalProject = validateProject(context.originalBytes);
    manifest.originalSha256 = sha256(context.originalBytes);
  }
  manifest.profileOwner = await prepareProfile(args, process.env);
}

async function attach(context) {
  const { args, manifest } = context;
  context.app = await launchInstalledApp(args);
  manifest.pid = context.app.child.pid;
  manifest.launchArgs = context.app.launchArgs;
  manifest.debugger = await findDebugger(context.app, args['expected-profile']);
  const { chromium } = await import('@playwright/test');
  context.browser = await chromium.connectOverCDP(manifest.debugger.endpoint, { timeout: 30_000 });
  context.page = await waitUntil(
    () =>
      context.browser
        .contexts()
        .flatMap((item) => item.pages())
        .find((page) => page.url() === 'app://app/index.html'),
    'packaged app renderer',
  );
  context.page.setDefaultTimeout(20_000);
  context.page.on('pageerror', (error) =>
    manifest.rendererErrors.push({ kind: 'pageerror', message: error.message }),
  );
  context.page.on('console', (message) => {
    if (message.type() === 'error')
      manifest.rendererErrors.push({ kind: 'console', message: message.text() });
  });
  context.page.on('dialog', (dialog) => {
    manifest.rendererErrors.push({
      kind: 'unexpected-dialog',
      type: dialog.type(),
      message: dialog.message(),
    });
    void dialog.dismiss().catch(() => undefined);
  });
  await context.page
    .getByRole('banner', { name: 'Toolbar', exact: true })
    .waitFor({ state: 'visible' });
  // Observe transient errors and actual clicks without replacing any app or picker API.
  await context.page.exposeFunction('recordInstalledUiEvidence', (event) => {
    if (manifest.uiEvents.length < 100) manifest.uiEvents.push(event);
  });
  await context.page.evaluate(() => {
    const record = (event) =>
      void globalThis.recordInstalledUiEvidence({ ...event, at: new Date().toISOString() });
    const notifications = globalThis.document.querySelector(
      '[role="region"][aria-label="Notifications"]',
    );
    if (notifications) {
      new globalThis.MutationObserver(() => {
        record({ kind: 'notifications', text: notifications.textContent });
      }).observe(notifications, { childList: true, subtree: true, characterData: true });
    }
    globalThis.document.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest?.('button');
        if (button)
          record({
            kind: 'click',
            button: button.getAttribute('aria-label') ?? button.textContent,
            trusted: event.isTrusted,
            activeUserGesture: globalThis.navigator.userActivation.isActive,
          });
      },
      { capture: true },
    );
  });
  const badge = await context.page
    .getByLabel('Build version', { exact: true })
    .getAttribute('title');
  manifest.build = assertBuildMetadata(badge ?? '', args);
  manifest.nativeWindow = await runNativeHelper(
    args,
    'Inspect',
    'initial-window',
    context.app.child.pid,
  );
  manifest.runtime = await bounded(
    context.page.evaluate(() => ({
      userAgent: globalThis.navigator.userAgent,
      url: globalThis.location.href,
      title: globalThis.document.title,
      visibility: globalThis.document.visibilityState,
      hasFocus: globalThis.document.hasFocus(),
      filePickers: {
        open: typeof globalThis.showOpenFilePicker,
        save: typeof globalThis.showSaveFilePicker,
      },
    })),
    'renderer runtime evidence',
  );
  if (
    manifest.runtime.visibility !== 'visible' ||
    manifest.runtime.filePickers.open !== 'function' ||
    manifest.runtime.filePickers.save !== 'function'
  ) {
    throw new Error('Packaged renderer is not visible or lacks native file pickers');
  }
  const session = await bounded(context.browser.newBrowserCDPSession(), 'browser CDP session');
  manifest.runtime.protocol = await bounded(
    session.send('Browser.getVersion'),
    'runtime protocol version',
  );
  await bounded(session.detach(), 'version session detach');
  await context.page.screenshot({ path: join(args['output-root'], 'initial.png') });
}

async function fileCommand(page, name) {
  const toolbar = page.getByRole('banner', { name: 'Toolbar', exact: true });
  const button = toolbar.getByRole('button', { name, exact: true });
  if (await button.isVisible()) return button;
  const menu = page.getByRole('menu', { name: 'More commands', exact: true });
  if (!(await menu.isVisible())) {
    await toolbar.getByRole('button', { name: 'More commands', exact: true }).click();
  }
  const command = menu.getByRole('menuitem', { name, exact: true });
  await command.waitFor({ state: 'visible' });
  return command;
}

async function showRunOrder(page) {
  const panels = page.getByRole('region', { name: 'Workspace side panels', exact: true });
  await panels.waitFor({ state: 'visible' });
  const artwork = panels.getByRole('tab', { name: /^(Artwork|Cuts \/ Layers)$/ });
  if (await artwork.isVisible()) await artwork.click();
  await panels.getByRole('tab', { name: 'Run order', exact: true }).click();
}

async function useFileDialog(context, button, action, target, label) {
  // Resolve the real visible command first; overflow navigation must not consume
  // the native dialog's deadline or trigger a picker before the helper is ready.
  const command = await fileCommand(context.page, button);
  // Run the native helper before clicking: a modal picker can block the CDP click reply.
  const helper = runNativeHelper(context.args, action, label, context.app.child.pid, target);
  const click = command.click();
  const settled = await Promise.allSettled([helper, click]);
  const attempt = summarizeDialogResults(label, button, settled);
  context.manifest.dialogAttempts.push(attempt);
  if (attempt.failure) throw new Error(attempt.failure);
  return settled[0].value;
}

async function waitCleanTitle(context, target) {
  await context.page.waitForFunction(
    (filename) => globalThis.document.title === `KerfDesk — ${filename}`,
    basename(target),
    { timeout: 30_000 },
  );
}

async function createProject(context) {
  const { args, manifest } = context;
  const fixture = join(args['output-root'], FIXTURE_NAME);
  manifest.importDialog = await useFileDialog(
    context,
    'Import...',
    'Open',
    fixture,
    'import-dialog',
  );
  await showRunOrder(context.page);
  await context.page
    .getByRole('article', { name: 'Run 1: installed qualification artwork', exact: true })
    .waitFor({ state: 'visible' });
  await context.page.waitForFunction(() => globalThis.document.title.endsWith(' *'), null, {
    timeout: 30_000,
  });
  await context.page.screenshot({ path: join(args['output-root'], 'imported.png') });
  manifest.saveDialog = await useFileDialog(
    context,
    'Save As...',
    'Save',
    args.project,
    'save-dialog',
  );
  await waitCleanTitle(context, args.project);
  const bytes = await fs.readFile(args.project);
  const project = validateProject(bytes);
  manifest.persisted = {
    bytes: bytes.length,
    sha256: sha256(bytes),
    schemaVersion: project.schemaVersion,
    scene: project.scene,
  };
  await fs.writeFile(join(args['output-root'], 'saved-project.lf2'), bytes, { flag: 'wx' });
}

async function reopenProject(context) {
  const { args, manifest } = context;
  manifest.openDialog = await useFileDialog(
    context,
    'Open...',
    'Open',
    args.project,
    'open-dialog',
  );
  await waitCleanTitle(context, args.project);
  await showRunOrder(context.page);
  await context.page
    .getByRole('article', { name: 'Run 1: installed qualification artwork', exact: true })
    .waitFor({ state: 'visible' });
  await context.page.screenshot({ path: join(args['output-root'], 'reopened.png') });
  const roundtrip = join(args['output-root'], 'reopened-roundtrip.lf2');
  manifest.saveDialog = await useFileDialog(
    context,
    'Save As...',
    'Save',
    roundtrip,
    'roundtrip-dialog',
  );
  await waitCleanTitle(context, roundtrip);
  const bytes = await fs.readFile(roundtrip);
  const project = validateProject(bytes);
  assertRoundtrip(context.originalProject, project);
  if (sha256(await fs.readFile(args.project)) !== manifest.originalSha256)
    throw new Error('Reopen changed the original project file');
  manifest.persisted = {
    bytes: bytes.length,
    sha256: sha256(bytes),
    roundtrip,
    schemaVersion: project.schemaVersion,
    sceneEqual: true,
  };
}

async function finalize(context) {
  const { args, manifest, app } = context;
  if (context.page && manifest.failure) {
    await context.page
      .screenshot({ path: join(args['output-root'], 'failure.png'), timeout: 5000 })
      .catch(() => undefined);
  }
  if (app) {
    try {
      manifest.cleanup = await cleanupOwnedApp(args, app);
    } catch (error) {
      manifest.cleanup = { error: error.message };
      manifest.failure ??= `Cleanup: ${error.message}`;
    }
    await fs.writeFile(join(args['output-root'], 'app-stdout.txt'), app.stdout);
    await fs.writeFile(join(args['output-root'], 'app-stderr.txt'), app.stderr);
  }
  if (context.browser)
    await bounded(context.browser.close(), 'CDP disconnect', 5000).catch((error) => {
      manifest.failure ??= error.message;
    });
  manifest.finishedAt = new Date().toISOString();
  manifest.outcome = manifest.failure === null ? 'success' : 'failure';
  manifest.status = manifest.failure === null ? 'passed' : 'failed';
  await fs.writeFile(
    join(args['output-root'], 'result.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function run(args) {
  const context = await createContext(args);
  try {
    await stage(context, 'preflight-and-profile-ownership', () => preflight(context));
    await stage(context, 'normal-installed-launch-and-visible-window', () => attach(context));
    await stage(context, `native-file-dialog-${args.phase}`, () =>
      args.phase === 'create' ? createProject(context) : reopenProject(context),
    );
    await context.page.screenshot({ path: join(args['output-root'], 'saved.png') });
    await stage(context, 'normal-window-close', async () => {
      context.manifest.close = await closeInstalledApp(args, context.app);
    });
    if (context.manifest.rendererErrors.length)
      throw new Error('Renderer errors occurred; see result.json');
    // Re-read after process exit: evidence must outlive the app, not only exist in memory.
    const persistedPath =
      args.phase === 'create' ? args.project : context.manifest.persisted.roundtrip;
    if (sha256(await fs.readFile(persistedPath)) !== context.manifest.persisted.sha256)
      throw new Error('Saved file changed at process exit');
  } catch (error) {
    context.manifest.failure = error.stack ?? error.message;
  } finally {
    await finalize(context);
  }
  if (context.manifest.failure) throw new Error(context.manifest.failure);
  process.stdout.write(
    `Installed app ${args.phase} passed: ${join(args['output-root'], 'result.json')}\n`,
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await run(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`Installed app file I/O failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
