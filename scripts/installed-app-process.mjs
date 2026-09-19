import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function bounded(promise, label, timeoutMs = 30_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function waitUntil(read, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await read();
    if (result) return result;
    await new Promise((done) => setTimeout(done, 150));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}

export function observeChild(executable, args, options = {}) {
  const child = spawn(executable, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  const state = { child, stdout: '', stderr: '', exit: null, error: null };
  child.stdout.on('data', (data) => {
    state.stdout += data.toString();
  });
  child.stderr.on('data', (data) => {
    state.stderr += data.toString();
  });
  child.on('error', (error) => {
    state.error = error.message;
  });
  state.closed = new Promise((done) => {
    child.once('close', (code, signal) => {
      state.exit = { code, signal };
      done(state.exit);
    });
  });
  return state;
}

export async function runNativeHelper(args, action, label, pid = 0, filePath) {
  const evidence = join(args['output-root'], label);
  await fs.mkdir(evidence, { recursive: true });
  const command = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(HERE, 'installed-file-dialog.ps1'),
    '-Action',
    action,
    '-AppProcessId',
    String(pid),
    '-ExpectedExecutable',
    args.executable,
    '-EvidenceRoot',
    evidence,
    '-TimeoutSeconds',
    '30',
  ];
  if (filePath) command.push('-FilePath', filePath);
  const helper = observeChild('powershell.exe', command);
  try {
    await waitUntil(() => helper.exit, `${action} native helper`, 65_000);
  } finally {
    if (helper.exit === null) {
      helper.child.kill();
      await waitUntil(() => helper.exit, 'native helper termination', 5000);
    }
    await fs.writeFile(join(evidence, 'stdout.txt'), helper.stdout);
    await fs.writeFile(join(evidence, 'stderr.txt'), helper.stderr);
  }
  const result = JSON.parse(await fs.readFile(join(evidence, 'result.json'), 'utf8'));
  if (helper.error || helper.exit.code !== 0 || !result.ok) {
    throw new Error(
      `${action} native helper failed: ${helper.error ?? result.error ?? helper.stderr}`,
    );
  }
  return result;
}

export async function launchInstalledApp(args, observe = observeChild) {
  const launchArgs = ['--remote-debugging-port=0'];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const observed = observe(args.executable, launchArgs, {
    env,
    cwd: dirname(args.executable),
    // The GUI's real visibility is being qualified; only helper processes stay hidden.
    windowsHide: false,
  });
  observed.launchArgs = launchArgs;
  return observed;
}

export async function findDebugger(app, profile) {
  const endpoint = await waitUntil(async () => {
    if (app.error || app.exit)
      throw new Error(`Installed app exited before CDP: ${app.error ?? JSON.stringify(app.exit)}`);
    const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(
      app.stderr,
    );
    if (match) return match[1];
    return false;
  }, 'installed app loopback DevTools endpoint');
  const activePort = await waitUntil(async () => {
    try {
      const text = await fs.readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      const [port, pathname] = text.trim().split(/\r?\n/);
      return `ws://127.0.0.1:${port}${pathname}` === endpoint
        ? { port: Number(port), pathname }
        : false;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }, 'matching DevToolsActivePort in the expected profile');
  return { endpoint, activePort };
}

export async function closeInstalledApp(args, app) {
  if (app.exit !== null) throw new Error('Installed app exited before the normal close check');
  const close = await runNativeHelper(args, 'Close', 'normal-close', app.child.pid);
  await waitUntil(() => app.exit, 'ordinary window close', 20_000);
  if (app.exit.code !== 0 || app.error)
    throw new Error(`Installed app exit failed: ${app.error ?? JSON.stringify(app.exit)}`);
  return { close, exit: app.exit };
}

export async function cleanupOwnedApp(args, app) {
  if (!app.child.pid) {
    await waitUntil(() => app.exit, 'failed launch closure', 5000);
    return { forced: false, exit: app.exit };
  }
  if (app.exit !== null) return { forced: false, exit: app.exit };
  // Ownership check also works when the failed app never created a visible window.
  await runNativeHelper(args, 'Ownership', 'cleanup-ownership', app.child.pid);
  const killer = observeChild('taskkill.exe', ['/PID', String(app.child.pid), '/T', '/F']);
  await waitUntil(() => killer.exit, 'owned app tree termination', 10_000);
  await waitUntil(() => app.exit, 'owned app termination', 10_000);
  return {
    forced: true,
    exit: app.exit,
    taskkill: { ...killer.exit, stdout: killer.stdout, stderr: killer.stderr },
  };
}
